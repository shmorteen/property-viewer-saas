// A 4:3 tour photo needs roughly this many pixels to remain clear on common desktop screens.
export const TOUR_PHOTO_MIN_WIDTH = 1200
export const TOUR_PHOTO_MIN_HEIGHT = 900

export function isLowResolutionPhoto(width: number, height: number): boolean {
  return width < TOUR_PHOTO_MIN_WIDTH || height < TOUR_PHOTO_MIN_HEIGHT
}
