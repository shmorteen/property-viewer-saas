import uuid

import cv2
import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize


def vectorize(edges: list, building, prepared, labels: list, semantic: dict, opening_gaps: list | None = None) -> tuple[dict,list,list,dict]:
    edges = sorted(edges)
    h,w = prepared.binary.shape
    original_w,original_h=prepared.quality['width'],prepared.quality['height']
    stable = lambda value: str(uuid.uuid5(uuid.NAMESPACE_URL, prepared.digest+':'+value))
    vertices, lookup = [], {}
    def vertex(pixel):
        original = prepared.inverse @ np.array([*pixel,1.])
        x,y = round(float(original[0]/original_w),7),round(float(original[1]/original_h),7)
        if not 0 <= x <= 1 or not 0 <= y <= 1: raise ValueError('Deskewed walls exceed original image; crop with a margin and retry.')
        key = (x,y)
        if key not in lookup:
            lookup[key] = stable(f'v:{x}:{y}')
            vertices.append({'id':lookup[key], 'x':x, 'y':y})
        return lookup[key]
    walls = []
    for a,b in edges:
        aid,bid = vertex(a),vertex(b)
        if aid == bid: continue
        exterior = building.boundary.buffer(.01).covers(LineString([a,b]))
        walls.append({'id':stable('w:'+':'.join(sorted((aid,bid)))), 'a':aid,'b':bid,
                      'kind':'exterior' if exterior else 'interior', 'height':2.7,'thickness':.18 if exterior else .1})
    # Trace the actual concave exterior and include every junction along its edges.
    ring = []
    exterior = list(building.exterior.coords)
    pixel_vertices = {vertex(p):p for edge in edges for p in edge}
    for a,b in zip(exterior, exterior[1:]):
        segment = LineString([a,b])
        on_edge = [(segment.project(Point(p)),key) for key,p in pixel_vertices.items()
                   if segment.distance(Point(p)) < .01 and segment.project(Point(p)) < segment.length-.001]
        ring.extend(key for _,key in sorted(on_edge))
    ring = list(dict.fromkeys(ring))
    by_id = {v['id']:v for v in vertices}
    points = [(by_id[key]['x'],by_id[key]['y']) for key in ring]
    if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1])) < 0: ring.reverse()
    graph = {'property_boundary':[], 'building_boundary':ring,'vertices':vertices,'walls':walls,
             'rooms':[], 'openings':[], 'site_edges':[], 'stairs':[]}
    room_candidates = []
    for index,face in enumerate(polygonize([LineString([a,b]) for a,b in edges])):
        seed = face.representative_point()
        original = prepared.inverse @ np.array([seed.x,seed.y,1.])
        candidates = [label for label in labels if label['space_type'] and face.contains(Point(label['center']))]
        distinct = {label['space_type'] for label in candidates}
        label = max(candidates,key=lambda item:item['confidence']) if candidates and len(distinct) == 1 else None
        room_id = stable(f'room:{seed.x:.3f}:{seed.y:.3f}')
        position = {'x':float(original[0]/original_w),'y':float(original[1]/original_h)}
        graph['rooms'].append({'room_id':room_id,'point':position})
        room_candidates.append({'id':room_id,'point':position, 'name':label['text'][:80] if label else f'Space {index+1}',
            'space_type':label['space_type'] if label and label['confidence'] >= .8 else 'other',
            'confidence':label['confidence'] if label else .35,'raw_text':label['text'] if label else None,
            'label_options':[{'text':item['text'],'space_type':item['space_type'],'confidence':item['confidence']} for item in candidates],
            'source':'OCR contained in shared-wall face' if label else 'Open area with multiple labels; add virtual boundaries for separate rooms' if len(distinct)>1 else 'GEOS enclosed face; label unresolved'})
    unresolved, opening_meta = [], {}
    for kind in ('door','window'):
        if kind not in semantic: continue
        mask = ((semantic[kind] > .55)*255).astype(np.uint8)
        count,_,stats,centroids = cv2.connectedComponentsWithStats(mask)
        for i in range(1,count):
            x,y,bw,bh,area = stats[i]
            if area < 12: continue
            center = Point(centroids[i])
            ranked = sorted([(LineString([a,b]).distance(center),wall,a,b) for wall,(a,b) in zip(walls,edges)], key=lambda item:item[0])
            if not ranked: continue
            distance,wall,a,b = ranked[0]
            line = LineString([a,b])
            ts = [line.project(Point(p))/line.length for p in [(x,y),(x+bw,y),(x+bw,y+bh),(x,y+bh)]]
            start,end = min(ts),max(ts)
            ambiguous = distance > max(8,min(w,h)*.02) or end-start < .02 or start < .02 or end > .98
            ambiguous |= len(ranked)>1 and ranked[1][0] < distance+min(w,h)*.005
            # Bounding boxes with unknown swing are retained for review, not forced into a door.
            if kind == 'door': ambiguous = True
            # Model rectangles alone often describe furniture. Require the
            # proposed interval to overlap a reconstructed raster wall gap.
            corroborated=False
            for gap in opening_gaps or []:
                gap_line=LineString(gap['points'])
                if line.distance(gap_line.centroid)>max(4,min(w,h)*.01): continue
                ga,gb=sorted(line.project(Point(p))/line.length for p in gap['points'])
                overlap=max(0.,min(end,gb)-max(start,ga))
                if overlap/max(end-start,gb-ga,1e-6)>.35: corroborated=True
            if not corroborated: ambiguous=True
            if ambiguous or any(o['wall_id']==wall['id'] and start < o['end']+.01 and o['start'] < end+.01 for o in graph['openings']):
                points=[]
                for px,py in ((x,y),(x+bw,y),(x+bw,y+bh),(x,y+bh)):
                    original=prepared.inverse @ np.array([px,py,1.])
                    points.append({'x':float(original[0]/original_w),'y':float(original[1]/original_h)})
                unresolved.append({'kind':kind,'box':[int(x),int(y),int(bw),int(bh)],'points':points,'wall_id':wall['id'] if distance<=max(8,min(w,h)*.02) else None,
                    'reason':'Review host wall, raster-gap agreement, extent and door swing; place with the existing opening tool.'})
                continue
            # Wall direction may reverse during stable ID ordering; edges and walls retain matching direction.
            opening_id = stable(f'{kind}:{x}:{y}')
            graph['openings'].append({'id':opening_id,'wall_id':wall['id'],'type':'standard_window',
                'start':float(start),'end':float(end),'height':1.2,'sill':.9,'swing':1,'preset':'custom'})
            opening_meta[opening_id] = {'confidence':.65,'source':['semantic component','wall projection'],'review_required':True}
    return graph,room_candidates,unresolved,opening_meta
