import type { LevelType, Point, SpaceCategory, SpaceType, StairType } from './types'

type TemplateSpace = { name: string; type: SpaceType; category: SpaceCategory; height: number; polygon: Point[]; destination_level_index?: number; stair_type?: StairType }
type TemplateLevel = { name: string; type: LevelType; elevation: number; width: number; height: number; spaces: TemplateSpace[] }
export type LayoutTemplate = { id: string; label: string; description: string; levels: TemplateLevel[] }

const rectangle = (x: number, y: number, width: number, height: number): Point[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
const indoor = (name: string, type: SpaceType, x: number, y: number, w: number, h: number): TemplateSpace => ({ name, type, category: 'indoor', height: 2.7, polygon: rectangle(x, y, w, h) })
const outdoor = (name: string, type: SpaceType, x: number, y: number, w: number, h: number): TemplateSpace => ({ name, type, category: 'outdoor', height: 0.1, polygon: rectangle(x, y, w, h) })
const ground = (spaces: TemplateSpace[]): TemplateLevel => ({ name: 'Ground Floor', type: 'ground', elevation: 0, width: 1200, height: 900, spaces })
const first = (spaces: TemplateSpace[]): TemplateLevel => ({ name: 'First Floor', type: 'upper', elevation: 2.7, width: 1200, height: 900, spaces })
const site = (): TemplateLevel => ({ name: 'Site / Outdoor', type: 'site', elevation: 0, width: 1200, height: 900, spaces: [
  outdoor('Building footprint', 'building_footprint', .30, .20, .50, .50),
  outdoor('Garden', 'garden', .05, .10, .20, .70),
  outdoor('Parking', 'parking', .55, .75, .24, .17),
  outdoor('Driveway', 'driveway', .81, .20, .13, .72),
] })
const stair = (x: number, y: number): TemplateSpace => ({ ...indoor('Stairs', 'stairs', x, y, .16, .22), destination_level_index: 1, stair_type: 'straight' })

export const layoutTemplates: LayoutTemplate[] = [
  { id: 'studio', label: 'Studio apartment', description: 'Open living space with a kitchen and bathroom.', levels: [ground([
    indoor('Living and sleeping', 'studio', .06, .08, .56, .78), indoor('Kitchen', 'kitchen', .65, .08, .29, .38), indoor('Bathroom', 'bathroom', .65, .49, .29, .37),
  ])] },
  { id: 'one-bed', label: '1-bedroom apartment', description: 'A compact apartment with a separate bedroom.', levels: [ground([
    indoor('Living room', 'living_room', .06, .07, .44, .48), indoor('Kitchen', 'kitchen', .53, .07, .41, .27), indoor('Bathroom', 'bathroom', .53, .37, .19, .18),
    indoor('Bedroom 1', 'bedroom', .06, .59, .53, .34), indoor('Corridor', 'corridor', .75, .37, .19, .56),
  ])] },
  { id: 'two-bed', label: '2-bedroom apartment', description: 'Two bedrooms around a central shared space.', levels: [ground([
    indoor('Living room', 'living_room', .05, .06, .46, .43), indoor('Kitchen', 'kitchen', .54, .06, .40, .23), indoor('Bathroom', 'bathroom', .54, .32, .19, .17),
    indoor('Bedroom 1', 'bedroom', .05, .53, .28, .40), indoor('Bedroom 2', 'bedroom', .36, .53, .29, .40), indoor('Corridor', 'corridor', .68, .53, .26, .40),
  ])] },
  { id: 'three-bed', label: '3-bedroom apartment', description: 'Three bedrooms, lounge, kitchen, and bathroom.', levels: [ground([
    indoor('Living room', 'living_room', .05, .05, .45, .37), indoor('Kitchen', 'kitchen', .53, .05, .41, .20), indoor('Bathroom', 'bathroom', .53, .28, .18, .14),
    indoor('Bedroom 1', 'bedroom', .05, .46, .26, .47), indoor('Bedroom 2', 'bedroom', .34, .46, .26, .47), indoor('Bedroom 3', 'bedroom', .63, .46, .31, .27),
    indoor('Corridor', 'corridor', .63, .76, .31, .17),
  ])] },
  { id: 'bungalow', label: '3-bedroom bungalow', description: 'Single-level home with a site layout.', levels: [site(), ground([
    indoor('Living room', 'living_room', .05, .05, .46, .35), indoor('Kitchen', 'kitchen', .54, .05, .40, .19), indoor('Bathroom', 'bathroom', .54, .27, .18, .13),
    indoor('Bedroom 1', 'bedroom', .05, .44, .26, .49), indoor('Bedroom 2', 'bedroom', .34, .44, .26, .49), indoor('Bedroom 3', 'bedroom', .63, .44, .31, .29),
    indoor('Corridor', 'corridor', .63, .76, .31, .17),
  ])] },
  { id: 'three-duplex', label: '3-bedroom duplex', description: 'Living spaces downstairs and bedrooms upstairs.', levels: [ground([
    indoor('Living room', 'living_room', .06, .06, .51, .50), indoor('Kitchen', 'kitchen', .60, .06, .34, .34),
    indoor('Bathroom', 'bathroom', .60, .43, .16, .17), stair(.78, .43), indoor('Dining room', 'dining_room', .06, .60, .69, .33),
  ]), first([
    indoor('Bedroom 1', 'bedroom', .06, .06, .42, .39), indoor('Bedroom 2', 'bedroom', .51, .06, .43, .39),
    indoor('Bedroom 3', 'bedroom', .06, .49, .42, .44), indoor('Bathroom', 'bathroom', .51, .49, .21, .25), indoor('Landing', 'corridor', .75, .49, .19, .44),
  ])] },
  { id: 'four-duplex', label: '4-bedroom duplex', description: 'Larger two-level family layout.', levels: [ground([
    indoor('Living room', 'living_room', .05, .05, .48, .40), indoor('Kitchen', 'kitchen', .56, .05, .38, .25),
    indoor('Bedroom 1', 'bedroom', .05, .49, .29, .44), indoor('Dining room', 'dining_room', .37, .49, .38, .44), stair(.78, .48),
  ]), first([
    indoor('Bedroom 2', 'bedroom', .05, .05, .42, .39), indoor('Bedroom 3', 'bedroom', .50, .05, .44, .39),
    indoor('Bedroom 4', 'bedroom', .05, .48, .42, .45), indoor('Bathroom', 'bathroom', .50, .48, .22, .25), indoor('Landing', 'corridor', .75, .48, .19, .45),
  ])] },
]
