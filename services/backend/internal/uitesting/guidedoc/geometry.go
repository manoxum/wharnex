package guidedoc

import "math"

// Crops never zoom past these fractions of the capture, and keep a readable
// aspect ratio, so a focused view still shows where on the screen it is.
const (
	minRegionW   = 0.42
	minRegionH   = 0.30
	maxAspect    = 2.6
	minAspect    = 0.9
	focusPadding = 0.06
)

// Full is the whole capture.
func Full() Rect { return Rect{W: 1, H: 1} }

// Valid reports whether r is a non-empty box inside the capture.
func (r Rect) Valid() bool {
	finite := !math.IsNaN(r.X+r.Y+r.W+r.H) && !math.IsInf(r.X+r.Y+r.W+r.H, 0)
	return finite && r.X >= 0 && r.Y >= 0 && r.W > 0 && r.H > 0 && r.X+r.W <= 1.0001 && r.Y+r.H <= 1.0001
}

// Center is the middle point of r.
func (r Rect) Center() (float64, float64) { return r.X + r.W/2, r.Y + r.H/2 }

// Contains reports whether the point lies inside r.
func (r Rect) Contains(x, y float64) bool {
	return x >= r.X-0.0001 && y >= r.Y-0.0001 && x <= r.X+r.W+0.0001 && y <= r.Y+r.H+0.0001
}

// IsFull reports whether r covers the whole capture.
func (r Rect) IsFull() bool { return r.X <= 0.0001 && r.Y <= 0.0001 && r.W >= 0.9999 && r.H >= 0.9999 }

// FocusOn is the crop around boxes: their union, padded, then fitted.
func FocusOn(boxes []Rect, width, height int) Rect {
	if len(boxes) == 0 {
		return Full()
	}
	left, top, right, bottom := 1.0, 1.0, 0.0, 0.0
	for _, box := range boxes {
		left, top = math.Min(left, box.X), math.Min(top, box.Y)
		right, bottom = math.Max(right, box.X+box.W), math.Max(bottom, box.Y+box.H)
	}
	return Fit(Rect{X: left - focusPadding, Y: top - focusPadding, W: right - left + 2*focusPadding, H: bottom - top + 2*focusPadding}, width, height)
}

// Fit grows r to the minimum size and a readable aspect ratio around its
// centre, then slides it back inside the capture.
func Fit(r Rect, width, height int) Rect {
	if width <= 0 || height <= 0 {
		return Full()
	}
	cx, cy := r.Center()
	w, h := math.Max(r.W, minRegionW), math.Max(r.H, minRegionH)
	ratio := float64(width) / float64(height)
	if aspect := w * ratio / h; aspect > maxAspect {
		h = w * ratio / maxAspect
	} else if aspect < minAspect {
		w = minAspect * h / ratio
	}
	w, h = math.Min(w, 1), math.Min(h, 1)
	x := math.Min(math.Max(cx-w/2, 0), 1-w)
	y := math.Min(math.Max(cy-h/2, 0), 1-h)
	fitted := Rect{X: round(x), Y: round(y), W: round(w), H: round(h)}
	if fitted.W >= 0.97 && fitted.H >= 0.97 {
		return Full()
	}
	return fitted
}

// Within maps box to fractions of region, for drawing inside a crop.
func Within(box, region Rect) Rect {
	if region.W <= 0 || region.H <= 0 {
		return box
	}
	return Rect{X: (box.X - region.X) / region.W, Y: (box.Y - region.Y) / region.H, W: box.W / region.W, H: box.H / region.H}
}

func round(value float64) float64 { return math.Round(value*10000) / 10000 }
