package uitesting

// retireTests removes discovered tests GPT declared obsolete. Operator tests
// and tests something still depends on are kept.
func retireTests(tests []TestCase, obsolete []string) []TestCase {
	if len(obsolete) == 0 {
		return tests
	}
	retire := map[string]bool{}
	for _, id := range obsolete {
		retire[id] = true
	}
	for changed := true; changed; {
		changed = false
		for _, test := range tests {
			if retire[test.ID] {
				continue
			}
			for _, dep := range test.DependsOn {
				if retire[dep] {
					delete(retire, dep)
					changed = true
				}
			}
		}
	}
	kept := tests[:0:0]
	for _, test := range tests {
		if retire[test.ID] && test.Source != SourceUser {
			continue
		}
		kept = append(kept, test)
	}
	return kept
}

// testsOfEnvironments lists the tests that live in retired environments.
func testsOfEnvironments(tests []TestCase, environments []string) []string {
	retired := map[string]bool{}
	for _, id := range environments {
		retired[id] = true
	}
	ids := []string{}
	for _, test := range tests {
		if retired[test.EnvironmentID] {
			ids = append(ids, test.ID)
		}
	}
	return ids
}

// retireEnvironments removes retired environments that no remaining test uses;
// an environment still holding an operator test stays.
func retireEnvironments(environments []Environment, tests []TestCase, retired []string) []Environment {
	if len(retired) == 0 {
		return environments
	}
	drop := map[string]bool{}
	for _, id := range retired {
		drop[id] = true
	}
	for _, test := range tests {
		delete(drop, test.EnvironmentID)
	}
	kept := environments[:0:0]
	for _, env := range environments {
		if !drop[env.ID] {
			kept = append(kept, env)
		}
	}
	return kept
}
