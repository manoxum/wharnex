package app

import (
	"context"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/hostrepo"
)

const gitContributorHistoryLimit = 10000

// GitContributionWeek is one Monday-based UTC bucket in the contributors
// timeline. Keeping the buckets on the server makes the ranking and graph use
// exactly the same history sample.
type GitContributionWeek struct {
	StartedAt time.Time `json:"started_at"`
	Commits   int       `json:"commits"`
	Additions int       `json:"additions"`
	Deletions int       `json:"deletions"`
}

// GitContributionDay keeps the exact UTC day buckets used by the GitHub-style
// contribution calendar in the contributors surface. Only active days are
// transported; the frontend fills empty calendar cells locally.
type GitContributionDay struct {
	StartedAt time.Time `json:"started_at"`
	Commits   int       `json:"commits"`
	Additions int       `json:"additions"`
	Deletions int       `json:"deletions"`
}

// GitContributor contains all-time totals for the sampled repository history
// plus a compact weekly series aligned with GitContributorsOverview.Weeks.
type GitContributor struct {
	Name          string    `json:"name"`
	Email         string    `json:"email"`
	Commits       int       `json:"commits"`
	Additions     int       `json:"additions"`
	Deletions     int       `json:"deletions"`
	FirstCommitAt time.Time `json:"first_commit_at"`
	LastCommitAt  time.Time `json:"last_commit_at"`
	WeeklyCommits []int     `json:"weekly_commits"`
}

type GitContributorsOverview struct {
	Contributors []GitContributor      `json:"contributors"`
	Weeks        []GitContributionWeek `json:"weeks"`
	Days         []GitContributionDay  `json:"days"`
	TotalCommits int                   `json:"total_commits"`
	Truncated    bool                  `json:"truncated"`
}

// GitContributors builds a repository-wide contributor ranking and weekly
// activity timeline from commits reachable from any ref. Merge commits are
// ignored so integrating an existing branch does not count as new authored
// work. Very large repositories are bounded to keep this UI endpoint
// responsive; Truncated tells the frontend when the ranking is sampled.
func (s *Service) GitContributors(ctx context.Context, sessionID string) (GitContributorsOverview, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitContributorsOverview{}, err
	}
	commits, err := hostrepo.LogRefsPage(ctx, item.ProjectPath, nil, true, gitContributorHistoryLimit+1, 0)
	if err != nil {
		return GitContributorsOverview{}, err
	}
	truncated := len(commits) > gitContributorHistoryLimit
	if truncated {
		commits = commits[:gitContributorHistoryLimit]
	}

	type contributorAccumulator struct {
		GitContributor
		weeks map[time.Time]int
	}
	contributors := map[string]*contributorAccumulator{}
	weekTotals := map[time.Time]*GitContributionWeek{}
	dayTotals := map[time.Time]*GitContributionDay{}
	var firstWeek, lastWeek time.Time
	totalCommits := 0
	for _, commit := range commits {
		if commit.Merge || commit.CommittedAt.IsZero() {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(commit.AuthorEmail))
		if key == "" {
			key = strings.ToLower(strings.TrimSpace(commit.AuthorName))
		}
		if key == "" {
			continue
		}
		week := gitContributionWeekStart(commit.CommittedAt)
		day := gitContributionDayStart(commit.CommittedAt)
		if firstWeek.IsZero() || week.Before(firstWeek) {
			firstWeek = week
		}
		if lastWeek.IsZero() || week.After(lastWeek) {
			lastWeek = week
		}
		total := weekTotals[week]
		if total == nil {
			total = &GitContributionWeek{StartedAt: week}
			weekTotals[week] = total
		}
		total.Commits++
		total.Additions += commit.Additions
		total.Deletions += commit.Deletions
		daily := dayTotals[day]
		if daily == nil {
			daily = &GitContributionDay{StartedAt: day}
			dayTotals[day] = daily
		}
		daily.Commits++
		daily.Additions += commit.Additions
		daily.Deletions += commit.Deletions
		totalCommits++

		contributor := contributors[key]
		if contributor == nil {
			contributor = &contributorAccumulator{GitContributor: GitContributor{Name: commit.AuthorName, Email: commit.AuthorEmail}, weeks: map[time.Time]int{}}
			contributors[key] = contributor
		}
		contributor.Commits++
		contributor.Additions += commit.Additions
		contributor.Deletions += commit.Deletions
		contributor.weeks[week]++
		if contributor.FirstCommitAt.IsZero() || commit.CommittedAt.Before(contributor.FirstCommitAt) {
			contributor.FirstCommitAt = commit.CommittedAt
		}
		if contributor.LastCommitAt.IsZero() || commit.CommittedAt.After(contributor.LastCommitAt) {
			contributor.LastCommitAt = commit.CommittedAt
			contributor.Name = commit.AuthorName
			contributor.Email = commit.AuthorEmail
		}
	}

	weeks := []GitContributionWeek{}
	weekIndexes := map[time.Time]int{}
	if !firstWeek.IsZero() {
		for week := firstWeek; !week.After(lastWeek); week = week.AddDate(0, 0, 7) {
			entry := GitContributionWeek{StartedAt: week}
			if total := weekTotals[week]; total != nil {
				entry = *total
			}
			weekIndexes[week] = len(weeks)
			weeks = append(weeks, entry)
		}
	}

	days := make([]GitContributionDay, 0, len(dayTotals))
	for _, day := range dayTotals {
		days = append(days, *day)
	}
	sort.Slice(days, func(i, j int) bool { return days[i].StartedAt.Before(days[j].StartedAt) })

	ranked := make([]GitContributor, 0, len(contributors))
	for _, contributor := range contributors {
		contributor.WeeklyCommits = make([]int, len(weeks))
		for week, count := range contributor.weeks {
			if index, ok := weekIndexes[week]; ok {
				contributor.WeeklyCommits[index] = count
			}
		}
		ranked = append(ranked, contributor.GitContributor)
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].Commits != ranked[j].Commits {
			return ranked[i].Commits > ranked[j].Commits
		}
		leftChanges := ranked[i].Additions + ranked[i].Deletions
		rightChanges := ranked[j].Additions + ranked[j].Deletions
		if leftChanges != rightChanges {
			return leftChanges > rightChanges
		}
		return strings.ToLower(ranked[i].Name) < strings.ToLower(ranked[j].Name)
	})
	return GitContributorsOverview{Contributors: ranked, Weeks: weeks, Days: days, TotalCommits: totalCommits, Truncated: truncated}, nil
}

func gitContributionDayStart(value time.Time) time.Time {
	value = value.UTC()
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func gitContributionWeekStart(value time.Time) time.Time {
	value = value.UTC()
	day := time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
	weekday := int(day.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	return day.AddDate(0, 0, -(weekday - 1))
}
