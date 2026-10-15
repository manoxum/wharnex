// Package residency owns bounded whole-session retention, independently of storage.
package residency

import "container/list"

type entry struct {
	id    string
	bytes int64
}

// Cache tracks admission and recency; the Store owns the actual session values
// and serializes all calls with its write mutex.
// A nil cache is the development store's unbounded, whole-session posture.
type Cache struct {
	maxItems int
	maxBytes int64
	bytes    int64
	order    *list.List
	index    map[string]*list.Element
}

func New(maxItems int, maxBytes int64) *Cache {
	return &Cache{maxItems: maxItems, maxBytes: maxBytes, order: list.New(), index: make(map[string]*list.Element)}
}

func (c *Cache) SetLimits(items int, bytes int64) {
	c.maxItems, c.maxBytes = items, bytes
}

func (c *Cache) Hot(id string) bool {
	if c == nil {
		return true
	}
	_, ok := c.index[id]
	return ok
}

// Promote returns every session the owner must replace with its slim view.
func (c *Cache) Promote(id string, bytes int64) []string {
	if c == nil {
		return nil
	}
	c.Forget(id)
	// Return the full value to the caller without retaining an aggregate that
	// cannot fit. Existing small entries remain available to other live work.
	if bytes > c.maxBytes || c.maxItems < 1 {
		return []string{id}
	}
	c.index[id] = c.order.PushFront(&entry{id: id, bytes: bytes})
	c.bytes += bytes
	var demoted []string
	for c.order.Len() > 1 && (c.order.Len() > c.maxItems || c.bytes > c.maxBytes) {
		oldest := c.order.Back().Value.(*entry)
		c.Forget(oldest.id)
		demoted = append(demoted, oldest.id)
	}
	return demoted
}

func (c *Cache) Touch(id string) {
	if c == nil {
		return
	}
	if element, ok := c.index[id]; ok {
		c.order.MoveToFront(element)
	}
}

func (c *Cache) Forget(id string) {
	if c == nil {
		return
	}
	if element, ok := c.index[id]; ok {
		c.bytes -= element.Value.(*entry).bytes
		c.order.Remove(element)
		delete(c.index, id)
	}
}

func (c *Cache) Reset() {
	if c == nil {
		return
	}
	c.bytes = 0
	c.order.Init()
	c.index = make(map[string]*list.Element)
}
