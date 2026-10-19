import math

import networkx as nx
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union


def validate(graph: dict) -> list[str]:
    errors = []
    vertices = {v['id']: v for v in graph.get('vertices', [])}
    if len(vertices) != len(graph.get('vertices', [])): errors.append('Duplicate vertex IDs')
    try:
        outline = Polygon([(vertices[key]['x'],vertices[key]['y']) for key in graph['building_boundary']])
    except (KeyError, ValueError): return errors + ['Missing building vertices']
    if not outline.is_valid or outline.area < .0005 or outline.interiors: errors.append('Invalid building footprint')
    physical, network, seen = [], nx.Graph(), set()
    for wall in graph.get('walls', []):
        if wall['a'] not in vertices or wall['b'] not in vertices:
            errors.append('Orphan wall'); continue
        a,b = vertices[wall['a']],vertices[wall['b']]
        line = LineString([(a['x'],a['y']),(b['x'],b['y'])])
        pair = tuple(sorted((wall['a'],wall['b'])))
        if pair in seen: errors.append('Duplicate wall')
        seen.add(pair)
        if line.length < .005: errors.append('Zero or tiny wall')
        if not outline.buffer(1e-7).covers(line): errors.append('Wall outside building')
        physical.append((wall,line)); network.add_edge(*pair)
    if network.number_of_nodes() and not nx.is_connected(network): errors.append('Disconnected wall graph')
    for i,(wall,line) in enumerate(physical):
        for other,other_line in physical[:i]:
            intersection = line.intersection(other_line)
            shared = set((wall['a'],wall['b'])) & set((other['a'],other['b']))
            if not intersection.is_empty and not shared: errors.append('Unnoded crossing or duplicate junction')
    faces = list(polygonize([line for _,line in physical]))
    if not faces: errors.append('No enclosed room faces')
    if any(face.area < .0005 or not outline.buffer(1e-7).covers(face) for face in faces): errors.append('Sliver or outside room face')
    if faces and abs(unary_union(faces).area-outline.area) > 1e-6: errors.append('Room faces do not cover footprint')
    for seed in graph.get('rooms', []):
        if sum(face.contains(Point(seed['point']['x'],seed['point']['y'])) for face in faces) != 1: errors.append('Room seed has no unique face')
    wall_ids = {wall['id'] for wall,_ in physical}
    for opening in graph.get('openings', []):
        if opening['wall_id'] not in wall_ids: errors.append('Orphan opening')
        if any(wall['id'] == opening['wall_id'] and wall['kind'] == 'virtual' for wall,_ in physical): errors.append('Opening requires a physical wall')
        if not .02 <= opening['start'] < opening['end'] <= .98 or opening['end']-opening['start'] < .02: errors.append('Invalid opening interval')
        if not all(math.isfinite(float(opening[key])) for key in ('start','end','height','sill')): errors.append('Nonfinite opening')
        for other in graph.get('openings', []):
            if other['id'] != opening['id'] and other['wall_id'] == opening['wall_id'] and opening['start'] < other['end']+.01 and other['start'] < opening['end']+.01: errors.append('Overlapping openings')
    return sorted(set(errors))
