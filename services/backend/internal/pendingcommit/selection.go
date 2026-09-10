package pendingcommit

import "sort"

// BlockingPredecessors reports records that are not selected but must be,
// because a selected record shares a path with them and was applied later.
//
// This is the correctness rule that makes selective committing meaningful.
// Committing a path takes its current working-tree content, which already
// contains every earlier change to that same path. Committing a later record
// alone would therefore silently fold an earlier, unselected change into it
// and label the result with the wrong message — producing history that
// misattributes work rather than merely being incomplete. Naming the blockers
// lets the caller refuse with something the operator can act on.
func BlockingPredecessors(records []Record, selected map[string]bool) []Record {
	blockers := make([]Record, 0)
	seen := map[string]bool{}
	for index, record := range records {
		if !selected[record.ID] {
			continue
		}
		paths := map[string]bool{}
		for _, path := range record.Paths {
			paths[path] = true
		}
		for _, earlier := range records[:index] {
			if selected[earlier.ID] || seen[earlier.ID] {
				continue
			}
			for _, path := range earlier.Paths {
				if paths[path] {
					seen[earlier.ID] = true
					blockers = append(blockers, earlier)
					break
				}
			}
		}
	}
	sort.SliceStable(blockers, func(left, right int) bool {
		return blockers[left].CreatedAt.Before(blockers[right].CreatedAt)
	})
	return blockers
}

// Select returns the records matching ids, in queue order, plus the ids that
// matched nothing.
func Select(records []Record, ids []string) (matched []Record, missing []string) {
	wanted := make(map[string]bool, len(ids))
	for _, id := range ids {
		wanted[id] = true
	}
	found := map[string]bool{}
	for _, record := range records {
		if wanted[record.ID] {
			matched = append(matched, record)
			found[record.ID] = true
		}
	}
	for _, id := range ids {
		if !found[id] {
			missing = append(missing, id)
		}
	}
	return matched, missing
}
