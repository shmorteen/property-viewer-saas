def report(graph: dict, rooms: list, model: dict, reconcile: dict, openings: dict) -> dict:
    # Evidence ratings are conservative heuristics, not calibrated probabilities.
    base = .85  # Geometry evidence is independent of optional model availability.
    if reconcile['discarded_fragments'] or reconcile['disconnected_components']: base -= .1
    return {'method':'heuristic evidence rating; not calibrated probability',
        'building':{'confidence':base,'source':['closed shared-wall exterior','GEOS']},
        'walls':{w['id']:{'confidence':base,'source':['line detector','geometry reconciliation']} for w in graph['walls']},
        'junctions':{v['id']:{'confidence':base,'source':['exact noding']} for v in graph['vertices']},
        'rooms':{r['id']:{'confidence':r['confidence'],'source':[r['source']]} for r in rooms},
        'openings':openings}
