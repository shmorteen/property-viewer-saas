import cv2
import numpy as np


def _runs(mask, horizontal, minimum):
    kernel=cv2.getStructuringElement(cv2.MORPH_RECT,(minimum,1) if horizontal else (1,minimum))
    opened=cv2.morphologyEx(mask,cv2.MORPH_OPEN,kernel)
    count,labels,stats,_=cv2.connectedComponentsWithStats(opened)
    found=[]
    for label in range(1,count):
        x,y,w,h,area=stats[label]
        length=w if horizontal else h
        if length<minimum: continue
        crop=(labels[y:y+h,x:x+w]==label)
        widths=crop.sum(axis=0 if horizontal else 1)
        stroke=float(np.median(widths[widths>0]))
        compact=(h if horizontal else w)>length*.22
        if (h if horizontal else w)>length*.35: continue
        weights=crop.sum(axis=1 if horizontal else 0)
        # Median band position is stable at intersections and short spurs.
        center=float(np.average(np.arange(len(weights)),weights=weights))+(y if horizontal else x)
        found.append({'axis':0 if horizontal else 1,'at':center,'lo':float(x if horizontal else y),
                      'hi':float(x+w-1 if horizontal else y+h-1),'stroke':stroke,'support':length,
                      'compact':compact})
    return found,opened


def _cluster_axes(runs, tolerance):
    result=[]
    # Cluster axis position only when the longitudinal runs overlap. Nearby but
    # spatially unrelated walls cannot pull each other's centerline sideways.
    for run in sorted(runs,key=lambda r:-r['support']):
        group=next((g for g in result if g['axis']==run['axis'] and abs(g['at']-run['at'])<=tolerance
                    and min(g['hi'],run['hi'])-max(g['lo'],run['lo'])>0),None)
        if group:
            weight=group['support']+run['support']
            group['at']=(group['at']*group['support']+run['at']*run['support'])/weight
            group['support']=weight;group['lo']=min(group['lo'],run['lo']);group['hi']=max(group['hi'],run['hi'])
            group['stroke']=max(group['stroke'],run['stroke'])
        else: result.append(run.copy())
    return result


def extract(binary: np.ndarray, semantic: dict, thresholds: dict | None=None) -> tuple[list,dict]:
    h,w=binary.shape;unit=min(w,h)
    masks=thresholds or {'combined':binary}
    # Gray, dark and locally thresholded runs are independent evidence sources.
    raw=[]
    minimum=max(12,round(unit*.045))
    for mask in masks.values():
        for horizontal in (True,False):
            runs,_=_runs(mask,horizontal,minimum)
            raw.extend(runs)
    long=[r['stroke'] for r in raw if not r['compact'] and r['hi']-r['lo']>=unit*.13]
    stroke=float(np.percentile(long,80)) if long else max(2.,unit*.006)
    stroke=float(np.clip(stroke,unit*.002,unit*.025))
    # Architectural walls may vary in thickness. Primary strokes establish the
    # scale; thinner structural runs remain if >= 55% of that scale.
    primary=[r for r in raw if not r['compact'] and r['stroke']>=max(unit*.0015,stroke*.55)]
    # A short thick wall joined to a corner can be wider than 22% of its
    # length. Keep it only as a continuation of an independently supported
    # structural axis; isolated furniture rectangles remain excluded.
    continuation_gap=min(unit*.17,stroke*18)
    filtered=primary+[r for r in raw if r['compact'] and r['stroke']>=max(unit*.0015,stroke*.55)
        and any(q['axis']==r['axis'] and q['support']>=unit*.25
                and abs(q['at']-r['at'])<=stroke*.65
                and max(r['lo']-q['hi'],q['lo']-r['hi'],0.)<=continuation_gap
                for q in primary)]
    structural=np.zeros_like(binary)
    for run in filtered:
        a=(round(run['lo']),round(run['at'])) if run['axis']==0 else (round(run['at']),round(run['lo']))
        b=(round(run['hi']),round(run['at'])) if run['axis']==0 else (round(run['at']),round(run['hi']))
        cv2.line(structural,a,b,255,max(1,round(run['stroke'])))
    axes=_cluster_axes(filtered,max(unit*.002,stroke*.8))
    # LSD is diagnostic corroboration, never a second set of duplicate wall axes.
    detected=cv2.createLineSegmentDetector().detect(binary)[0]
    lsd=[] if detected is None else detected[:,0].tolist()
    gaps=[];merged=[]
    max_gap=min(unit*.17,stroke*18)
    for run in sorted(axes,key=lambda r:(r['axis'],r['at'],r['lo'])):
        # Collinear fragments separated by a likely opening are joined after
        # axis clustering. Both sides must have structural run support.
        target=None
        for prior in merged:
            if prior['axis']!=run['axis'] or abs(prior['at']-run['at'])>max(stroke*.65,unit*.002): continue
            gap=max(run['lo']-prior['hi'],prior['lo']-run['hi'],0.)
            if gap>max_gap: continue
            if gap>0 and min(prior['hi']-prior['lo'],run['hi']-run['lo'])<max(stroke*2,gap*.35): continue
            # A transverse wall inside a missing run contradicts bridging across
            # a separate structural region. End junctions are allowed.
            low,high=sorted((prior['hi'],run['lo']))
            if gap>0 and any(q['axis']!=run['axis'] and low+stroke<q['at']<high-stroke
                and q['lo']+stroke<run['at']<q['hi']-stroke for q in axes): continue
            target=prior;break
        if target is None: merged.append(run.copy());continue
        gap_lo,gap_hi=min(target['hi'],run['hi']),max(target['lo'],run['lo'])
        if gap_hi-gap_lo>stroke*.7:
            at=(target['at']+run['at'])/2
            a=[gap_lo,at] if run['axis']==0 else [at,gap_lo]
            b=[gap_hi,at] if run['axis']==0 else [at,gap_hi]
            gaps.append({'points':[a,b],'confidence':.65,'source':'collinear structural fragments'})
        total=target['support']+run['support']
        target['at']=(target['at']*target['support']+run['at']*run['support'])/total
        target['support']=total;target['lo']=min(target['lo'],run['lo']);target['hi']=max(target['hi'],run['hi'])
    segments=[]
    for r in merged:
        a=[r['lo'],r['at']] if r['axis']==0 else [r['at'],r['lo']]
        b=[r['hi'],r['at']] if r['axis']==0 else [r['at'],r['hi']]
        segments.append((np.array(a),np.array(b)))
    if len(segments)>700: raise ValueError('Too many structural axes; use a clean single-floor orthogonal plan.')
    return segments,{'raw_segments':len(raw),'merged_segments':len(segments),'estimated_stroke_px':stroke,
        'junction_tolerance_px':max(stroke*1.6,unit*.006),'gap_candidates':gaps,
        'raw_axes':raw,'lsd_candidates':lsd,'structural_mask':structural,
        'source':['dark + gray + adaptive thresholds','directional morphology','stroke-weighted centerlines','LSD corroboration'],
        'semantic_structure_policy':'raster structural axes retained; model used only after structure'}
