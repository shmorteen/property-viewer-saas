"""Private local diagnostics, enabled only with an explicit development directory."""
from pathlib import Path
import cv2
import numpy as np

NAMES=['01_preprocessed','02_thresholds','03_structural_mask','04_raw_line_candidates','05_merged_wall_axes',
       '06_junction_graph','07_building_boundary','08_room_faces','09_ocr_overlay','10_opening_candidates']


class Debug:
    def __init__(self,prepared,directory):
        self.prepared=prepared
        self.base=cv2.cvtColor(prepared.rgb,cv2.COLOR_RGB2BGR)
        self.directory=Path(directory)/prepared.digest[:16] if directory else None
        if self.directory:
            self.directory.mkdir(parents=True,exist_ok=True)
            for name in NAMES:
                image=self.base.copy();cv2.putText(image,'Stage not reached',(15,30),cv2.FONT_HERSHEY_SIMPLEX,.7,(0,0,200),2)
                self.save(name,image)
            self.save(NAMES[0],self.base)
            self.save(NAMES[1],np.hstack([prepared.thresholds[k] for k in ('dark','gray','adaptive')]))

    def save(self,name,image):
        if self.directory: cv2.imwrite(str(self.directory/(name+'.png')),image)

    def lines(self,name,segments,nodes=False):
        if not self.directory: return
        image=self.base.copy()
        for a,b in segments:
            a,b=tuple(np.rint(a).astype(int)),tuple(np.rint(b).astype(int))
            cv2.line(image,a,b,(0,110,230),2)
            if nodes:
                cv2.circle(image,a,4,(0,180,20),-1);cv2.circle(image,b,4,(0,180,20),-1)
        self.save(name,image)

    def structure(self,edges,building):
        if not self.directory: return
        self.lines(NAMES[5],edges,True)
        image=self.base.copy()
        cv2.polylines(image,[np.rint(building.exterior.coords).astype(np.int32)],True,(0,180,0),3)
        self.save(NAMES[6],image)
        from shapely.ops import polygonize
        from shapely.geometry import LineString
        for i,face in enumerate(polygonize([LineString(edge) for edge in edges])):
            points=np.rint(face.exterior.coords).astype(np.int32)
            color=(int(40+i*67)%230,int(100+i*43)%230,int(180+i*89)%230)
            overlay=image.copy();cv2.fillPoly(overlay,[points],color);image=cv2.addWeighted(image,.65,overlay,.35,0)
        self.save(NAMES[7],image)

    def labels(self,labels):
        if not self.directory: return
        image=self.base.copy()
        for label in labels:
            if label.get('box'): cv2.polylines(image,[np.rint(label['box']).astype(np.int32)],True,(180,50,0),2)
            cv2.putText(image,label['text'],tuple(np.rint(label['center']).astype(int)),cv2.FONT_HERSHEY_SIMPLEX,.4,(0,0,200),1)
        self.save(NAMES[8],image)

    def openings(self,items):
        if not self.directory: return
        image=self.base.copy();h,w=image.shape[:2]
        transform=np.linalg.inv(self.prepared.inverse)
        for item in items:
            if not item.get('points'): continue
            points=[]
            for p in item['points']:
                q=transform@np.array([p['x']*self.prepared.quality['width'],p['y']*self.prepared.quality['height'],1.])
                points.append(q[:2])
            cv2.polylines(image,[np.rint(points).astype(np.int32)],len(points)>2,(0,0,230),2)
        self.save(NAMES[9],image)
