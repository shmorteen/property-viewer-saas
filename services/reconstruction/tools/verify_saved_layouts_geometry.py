"""Check actual separately reloaded QA rows through the existing GLB builder."""
import argparse
import copy
import io
import json
from pathlib import Path
import sys

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from geometry import build_model


def verify(rows, output):
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for index, row in enumerate(rows):
        graph = row['graph']
        level = {'id': row['level_id'], 'name': 'QA', 'elevation': 0,
                 'canvas_width': row['canvas_width'], 'canvas_height': row['canvas_height']}
        prop = {'id': row['property_id'], 'layout_width_m': float(row['width'])}
        glb, encoded = build_model(prop, [level], row['rooms'], row['polygons'], [],
                                   [{'level_id': level['id'], 'graph': graph}])
        manifest = json.loads(encoded)
        expected_rooms = {room['id']: room for room in row['rooms']}
        assert len(manifest['rooms']) == len(expected_rooms)
        for room in manifest['rooms']:
            for field in ('name', 'space_type', 'category'):
                assert room[field] == expected_rooms[room['id']][field]
        physical = {wall['id'] for wall in graph['walls'] if wall['kind'] != 'virtual'}
        assert len(manifest['walls']) == len(physical)
        assert {wall['id'] for wall in manifest['walls']} == physical
        accepted = {opening['id'] for opening in graph['openings']}
        actual = {opening['id'] for wall in manifest['walls'] for opening in wall['openings']}
        assert accepted == actual
        closed = copy.deepcopy(graph)
        closed['openings'] = []
        closed_glb, _ = build_model(prop, [level], row['rooms'], row['polygons'], [],
                                    [{'level_id': level['id'], 'graph': closed}])
        scene = trimesh.load(file_obj=io.BytesIO(glb), file_type='glb', force='scene')
        solid = trimesh.load(file_obj=io.BytesIO(closed_glb), file_type='glb', force='scene')
        # Floor surfaces are intentionally open/zero-volume; measure wall solids.
        wall_volume = lambda model: sum(abs(mesh.volume) for name, mesh in model.geometry.items() if name.startswith('wall_'))
        removed = wall_volume(solid) - wall_volume(scene)
        # The QA tool places a door inside one straight wall; its void volume is
        # independently measured from exported triangles, not just a manifest flag.
        expected_void = 0.
        vertices = {vertex['id']: vertex for vertex in graph['vertices']}
        for opening in graph['openings']:
            wall = next(wall for wall in graph['walls'] if wall['id'] == opening['wall_id'])
            a, b = vertices[wall['a']], vertices[wall['b']]
            width = prop['layout_width_m']
            depth = width * level['canvas_height'] / level['canvas_width']
            length = ((width * (a['x'] - b['x']))**2 + (depth * (a['y'] - b['y']))**2)**.5
            expected_void += length * (opening['end'] - opening['start']) * opening['height'] * wall['thickness']
        assert abs(removed - expected_void) < 1e-4, (removed, expected_void)
        (output / f'persisted-{index+1}.glb').write_bytes(glb)
        (output / f'persisted-{index+1}.manifest.json').write_bytes(encoded)
        results.append({'rooms': len(expected_rooms), 'physical_walls': len(physical),
                        'openings': len(accepted), 'glb_bytes': len(glb),
                        'measured_void_m3': round(removed, 6), 'expected_void_m3': round(expected_void, 6),
                        'identity_and_category_preserved': True})
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('readback', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    results = verify(json.loads(args.readback.read_text(encoding='utf-8')), args.output)
    (args.output / 'summary.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))
