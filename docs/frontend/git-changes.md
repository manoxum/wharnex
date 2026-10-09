# Collective Git changes

The Changes surface keeps the superproject and filters out submodules with no
local changes or outgoing commits. Branches and History keep the full inventory.
Branches without an upstream use the overview's unpublished commit flags.

**Publicar projeto** appears above the Git tabs, so it remains reachable from
every section. One review covers the current branch of every project
repository, including nested submodules and repositories with no locally known
outgoing commits. The inventory is reloaded before review. One confirmation
publishes children before parents and the superproject last; **Enviar commits**
still sends only repositories with outgoing commits. Neither action creates
commits. Unavailable repositories, detached HEADs, missing remotes and unresolved
operations block complete publication with the repository name and remedy.
Results identify each completed repository, including those already up to date;
a failure stops the remaining pushes and retains the completed results.

Pending changes share one message between the selected-file commit, **Commitar
tudo**, and **Commit e push** actions. **Enviar commits** remains reachable from
both changes subtabs. Collective commit plans include affected ancestors and run
deepest repositories first. Each parent records its direct child's new gitlink;
the action sends explicit planned paths and never enables the API's wildcard
`all` option. Dependency-only parent reviews explain the upcoming reference
update, whose final SHA exists only after its child's commit.

Commit and push confirms the commit review first, then reloads repository state
and calculates a fresh push review for explicit publication confirmation.
Publishing stops on any failure, including authentication errors or conflicts,
so a parent is not published after a failed child. Completed mutations remain
visible after refresh; the UI does not promise rollback across repositories.

The refactoring boundary is the Changes surface extracted from GitDrawer into
`components/git/review/changes`. The shared commit form and new collective action
toolbar use Tailwind; all superseded `.git-worktree-commit` rules were removed.
The unchanged file rows and per-repository pending-commit presentation retain
their existing CSS as the explicit scope exception. The new form uses important Tailwind font utilities to override the shared
legacy form typography without altering other controls. The remaining drawer tabs
and their legacy styling are outside this migration.

Project-wide publication and its shared push flow live in
`components/git/publication`, reusing the existing scoped Git APIs and review
modal. The new toolbar uses Tailwind; the extracted repository summary retains
its existing presentation. GitDrawer's unrelated branch, settings and diff
sections remain named extraction debt outside this change.

Model tests cover filtering, local-only commits, nested gitlinks and unavailable
actions. Interaction tests cover approval boundaries, commit/push order and
partial failures. The browser fixture uses stubbed Git operations and verifies
keyboard access and wrapping at 390px without changing a real repository.
