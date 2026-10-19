"""Authored analytic references: never label these as real human-verified plans."""
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np

ROOT=Path(__file__).parent/'fixtures'


def make(name,gray=False):
    width,height=500,400
    image=np.full((height,width,3),255,np.uint8)
    color=(155,155,155) if gray else (15,15,15)
    # Explicit centerline coordinates are the fixture specification.
    coordinates=[(70,70),(250,70),(430,70),(430,230),(430,330),(250,330),(70,330),(250,230)]
    segments=[(0,1),(1,2),(2,3),(3,4),(4,5),(5,6),(6,0),(1,7),(7,5),(7,3)]
    for a,b in segments: cv2.line(image,coordinates[a],coordinates[b],color,6,cv2.LINE_8)
    # Missing host-wall pixels: windows and doors, including outside perimeter.
    for a,b in [((140,70),(175,70)),((70,170),(70,205)),((250,150),(250,185)),((330,230),(362,230))]:
        cv2.line(image,a,b,(255,255,255),10)
    if gray:
        thin=(175,175,175)
        for rect in [(100,100,175,145),(310,100,390,150),(305,270,380,310)]:
            x0,y0,x1,y1=rect;cv2.rectangle(image,(x0,y0),(x1,y1),thin,1)
            cv2.line(image,(x0+8,y0+8),(x1-8,y0+8),thin,1)
        cv2.ellipse(image,(250,185),(35,35),0,270,360,thin,1)
        cv2.line(image,(250,185),(285,185),thin,1)
        # Dimension lines are darker than walls but much thinner and outside.
        for a,b in [((70,40),(430,40)),((40,70),(40,330)),((70,30),(70,50)),((430,30),(430,50))]:
            cv2.line(image,a,b,(90,90,90),1)
        cv2.putText(image,'12.0 m',(205,30),cv2.FONT_HERSHEY_SIMPLEX,.4,(100,100,100),1)
        for text,point in [('BEDROOM',(105,210)),('LIVING',(300,200)),('KITCHEN',(300,260))]:
            cv2.putText(image,text,point,cv2.FONT_HERSHEY_SIMPLEX,.4,(110,110,110),1)
    ROOT.mkdir(exist_ok=True)
    image_path=ROOT/(name+'.png');cv2.imwrite(str(image_path),image)
    vertices=[{'id':f'v{i}','x':x/width,'y':y/height} for i,(x,y) in enumerate(coordinates)]
    walls=[{'id':f'w{i}','a':f'v{a}','b':f'v{b}','kind':'exterior' if i<7 else 'interior','height':2.7,'thickness':.1} for i,(a,b) in enumerate(segments)]
    graph={'vertices':vertices,'walls':walls,'building_boundary':[f'v{i}' for i in range(7)],'property_boundary':[],
           'rooms':[],'openings':[], 'site_edges':[],'stairs':[]}
    for index,(wall,start,end,kind) in enumerate([('w0',70/180,105/180,'standard_window'),('w6',125/260,160/260,'standard_window'),('w7',80/160,115/160,'standard_door'),('w9',80/180,112/180,'standard_door')]):
        graph['openings'].append({'id':f'o{index}','wall_id':wall,'start':start,'end':end,'type':kind,'height':1.2 if 'window' in kind else 2.1,'sill':.9 if 'window' in kind else 0,'swing':1})
    truth={'reference_kind':'authored_analytic','verified_by':'Analytic centerline specification; agent visual review, not human ground truth',
           'verified_at':'2026-10-18','image_sha256':hashlib.sha256(image_path.read_bytes()).hexdigest(),
           'graph':graph,'rooms':[],'width_m':None,'note':'Door/window detection is scored separately from continuous host-wall structure.'}
    (ROOT/(name+'.truth.json')).write_text(json.dumps(truth,indent=2),encoding='utf-8')
    return {'id':name,'split':'development','image':f'fixtures/{name}.png','truth':f'fixtures/{name}.truth.json','kind':'authored_analytic'}


if __name__=='__main__':
    fixtures=[make('clean-dark'),make('gray-furnished',True)]
    (ROOT.parent/'regression-manifest.json').write_text(json.dumps({'description':'Authored regression references; not held-out real-plan evidence','fixtures':fixtures},indent=2),encoding='utf-8')
