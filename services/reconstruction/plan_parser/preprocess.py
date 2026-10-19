"""Preserve the upload; normalize only a bounded working image and its transform."""
from dataclasses import dataclass
import hashlib
import io

import cv2
import numpy as np
from PIL import Image, ImageOps


@dataclass
class Prepared:
    rgb: np.ndarray
    binary: np.ndarray
    inverse: np.ndarray  # working pixels -> original, EXIF-oriented pixels
    quality: dict
    digest: str
    thresholds: dict


def threshold_evidence(rgb):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    normalized = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8,8)).apply(gray)
    dark = ((gray < 205)*255).astype(np.uint8)
    gray_walls = ((gray < 238)*255).astype(np.uint8)
    adaptive = cv2.adaptiveThreshold(normalized,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY_INV,51,9)
    # Adaptive evidence retains faint edges; absolute gray avoids white JPEG noise.
    combined = cv2.bitwise_or(dark,cv2.bitwise_and(gray_walls,adaptive))
    chroma = rgb.max(axis=2).astype(float)-rgb.min(axis=2).astype(float)
    annotation = (chroma>35)&(rgb.mean(axis=2)>70)
    for mask in (dark,gray_walls,adaptive,combined): mask[annotation]=0
    return {'dark':dark,'gray':gray_walls,'adaptive':adaptive,'combined':combined}


def prepare(raw: bytes) -> Prepared:
    if not raw or len(raw)>15*1024*1024: raise ValueError('Use an original PNG, JPEG or WebP smaller than 15 MB.')
    with Image.open(io.BytesIO(raw)) as image:
        if image.format not in ('PNG','JPEG','WEBP'): raise ValueError('Unsupported plan image format.')
        if image.width*image.height>40_000_000: raise ValueError('Plan exceeds the 40 megapixel processing limit.')
        original=np.array(ImageOps.exif_transpose(image).convert('RGB'))
    h,w=original.shape[:2]
    gray=cv2.cvtColor(original,cv2.COLOR_RGB2GRAY)
    contrast=float(np.percentile(gray,99)-np.percentile(gray,1))
    blur=float(cv2.Laplacian(gray,cv2.CV_64F).var())
    ink=float(np.mean(gray<230))
    # Upsampling changes CV scale, not source resolution or available information.
    factor=min(4.,900/min(w,h)) if min(w,h)<800 else min(1.,2200/max(w,h))
    rw,rh=max(1,round(w*factor)),max(1,round(h*factor))
    working=cv2.resize(original,(rw,rh),interpolation=cv2.INTER_CUBIC if factor>1 else cv2.INTER_AREA) if (rw,rh)!=(w,h) else original.copy()
    scale=np.diag([rw/w,rh/h,1.])
    masks=threshold_evidence(working)
    segments=cv2.HoughLinesP(masks['combined'],1,np.pi/1800,max(25,min(rw,rh)//14),minLineLength=max(25,min(rw,rh)//8),maxLineGap=8)
    deviations=[]
    for line in ([] if segments is None else segments[:,0]):
        x0,y0,x1,y1=map(float,line)
        angle=np.degrees(np.arctan2(y1-y0,x1-x0)); deviation=(angle+45)%90-45
        if abs(deviation)<8: deviations.append(deviation)
    skew=float(np.median(deviations)) if deviations else 0.
    spread=float(np.std(deviations)) if deviations else 0.
    transform=scale.copy(); corrections=[]
    if (rw,rh)!=(w,h): corrections.append(f'working image resized to {rw} x {rh}; exact inverse scale retained')
    if .3<abs(skew)<=7 and spread<2:
        rotation=np.eye(3);rotation[:2]=cv2.getRotationMatrix2D((rw/2,rh/2),skew,1.)
        transform=rotation@scale
        working=cv2.warpAffine(working,rotation[:2],(rw,rh),borderValue=(255,255,255))
        masks=threshold_evidence(working)
        corrections.append(f'deskew {skew:.2f} degrees; inverse mapped to original coordinates')
    errors=[];warnings=[]
    if contrast<20: errors.append('Contrast is too low to distinguish structural lines.')
    if blur<4: errors.append('Image is too blurred or blank for reliable extraction.')
    if not .002<ink<.4: errors.append('No plausible dark-on-white line drawing was found.')
    if min(w,h)<800: warnings.append('Small source: structural working image normalized; OCR/opening confidence is reduced.')
    if spread>2: warnings.append('Possible perspective distortion or mixed orientations; only clean orthogonal plans are supported.')
    warnings.append('Perspective and compression estimates are heuristic; inspect the structural overlay.')
    return Prepared(working,masks['combined'],np.linalg.inv(transform),{
        'accepted':not errors,'width':w,'height':h,'processing_width':rw,'processing_height':rh,
        'native_resolution':(rw,rh)==(w,h),'original_preserved':True,'blur_laplacian':round(blur,3),
        'contrast':contrast,'ink_fraction':round(ink,4),'skew_degrees':round(skew,3),'orientation_spread':round(spread,3),
        'perspective':'suspected' if spread>2 else 'not established','compression':'not reliably measurable from decoded pixels',
        'corrections':corrections,'errors':errors,'warnings':warnings,
        'working_to_original':np.linalg.inv(transform).tolist(),
    },hashlib.sha256(raw).hexdigest(),masks)
