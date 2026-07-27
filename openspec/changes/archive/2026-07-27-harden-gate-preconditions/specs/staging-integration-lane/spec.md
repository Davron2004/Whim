## ADDED Requirements

### Requirement: The cleanup lane's printed apply command is valid for the lane's own topology

The cleanup outcome check SHALL print an apply command that works for the topology in which the
target branch is actually checked out. Under the staging lane the target is normally checked out in
a run worktree, where a `git checkout <target>` in the primary tree is rejected by git. The check
SHALL resolve where the target is checked out and print a command valid for that location.

#### Scenario: Target checked out in a run worktree

- **WHEN** the cleanup gate passes and the target branch is checked out in a run worktree
- **THEN** the printed apply command SHALL operate on that worktree, and SHALL NOT instruct the operator to check the target out in the primary tree

#### Scenario: Target not checked out anywhere

- **WHEN** the cleanup gate passes and the target branch is not checked out in any working tree
- **THEN** the printed apply command MAY use the primary-tree checkout form, since it is valid in that topology
