import networkx as nx
import numpy as np
from shapely import set_precision
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, snap, unary_union


def reconcile(segments: list, size: tuple[int, int], stroke: float | None = None) -> tuple[list, object, dict]:
    w, h = size
    tolerance = max(min(w,h)*.006, (stroke or min(w,h)*.006)*1.6)
    adjusted = [[a.copy(), b.copy()] for a,b in segments]
    joins = 0
    for i in range(len(adjusted)):
        for j in range(i):
            a,b = adjusted[i]
            v = b-a
            c,d = adjusted[j]
            u = d-c
            determinant = v[0]*u[1]-v[1]*u[0]
            if abs(determinant) < 1e-7: continue
            t = ((c[0]-a[0])*u[1]-(c[1]-a[1])*u[0])/determinant
            q = a+t*v
            if LineString([a,b]).distance(Point(q)) <= tolerance and LineString([c,d]).distance(Point(q)) <= tolerance:
                for edge in (adjusted[i], adjusted[j]):
                    index = int(np.argmin([np.linalg.norm(p-q) for p in edge]))
                    if np.linalg.norm(edge[index]-q) <= tolerance:
                        edge[index] = q.copy()
                        joins += 1
    lines = [LineString([a,b]) for a,b in adjusted if np.linalg.norm(b-a) >= min(w,h)*.005]
    if not lines: raise ValueError('No structural wall candidates were found.')
    union = unary_union(lines)
    union = set_precision(unary_union(snap(union, union, tolerance*.3)), .001)
    pieces = [line for line in getattr(union, 'geoms', [union]) if isinstance(line, LineString)]
    network = nx.Graph()
    for line in pieces:
        coords = list(line.coords)
        for a,b in zip(coords, coords[1:]): network.add_edge(tuple(a), tuple(b))
    candidates = []
    for component in nx.connected_components(network):
        component_lines = [LineString([a,b]) for a,b in network.subgraph(component).edges]
        faces = [poly for poly in polygonize(component_lines) if poly.area/(w*h) >= .0005]
        if faces: candidates.append((sum(poly.area for poly in faces), faces, component_lines))
    if not candidates: raise ValueError('No closed building was detected. Continue with manual tracing.')
    _, faces, component_lines = max(candidates, key=lambda item: item[0])
    building = unary_union(faces)
    if building.geom_type != 'Polygon' or not building.is_valid or building.interiors:
        raise ValueError('Building is disconnected or contains an unresolved courtyard; review manually.')
    # Retain only edges of enclosed faces. Isolated symbols/furniture never become walls.
    boundary_network = set_precision(unary_union([poly.boundary for poly in faces]), .001)
    edges = []
    for line in getattr(boundary_network, 'geoms', [boundary_network]):
        for a,b in zip(list(line.coords), list(line.coords)[1:]):
            if np.linalg.norm(np.array(b)-a) >= min(w,h)*.005:
                edges.append((a,b))
    retained_graph=nx.Graph();retained_graph.add_edges_from(edges)
    exterior_point=tuple(building.exterior.coords[0])
    anchor=min(retained_graph.nodes,key=lambda p:Point(p).distance(Point(exterior_point)))
    connected=nx.node_connected_component(retained_graph,anchor)
    edges=[(a,b) for a,b in edges if a in connected and b in connected]
    if not 3 <= len(edges) <= 700: raise ValueError('Reconciled wall count is outside the supported range.')
    retained = boundary_network.buffer(tolerance*.5)
    total_length = sum(line.length for line in lines)
    unsupported_length = sum(line.difference(retained).length for line in lines)
    discarded_fraction = unsupported_length/max(total_length,1.)
    if building.area/(w*h)<.01: raise ValueError('Only a small isolated cycle was reconstructed; no plausible building exterior.')
    unresolved=[]
    for line in component_lines:
        if line.difference(retained).length>tolerance*2:
            unresolved.append([list(line.coords[0]),list(line.coords[-1])])
    dropped = max(0, len(component_lines)-len(edges))
    return edges, building, {'discarded_structural_length_fraction':round(discarded_fraction,4), 'snapped_junctions': joins, 'discarded_fragments': dropped,
        'unresolved_structural_fragments':unresolved, 'disconnected_components': max(0, len(candidates)-1), 'source': ['GEOS noding', 'connected graph', 'polygonization']}
