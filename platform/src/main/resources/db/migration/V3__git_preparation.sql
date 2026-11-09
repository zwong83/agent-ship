-- Verified provider branch metadata. A run keeps its own default-branch snapshot.
ALTER TABLE agentship_design.repository ADD COLUMN default_branch text CHECK (default_branch IS NULL OR btrim(default_branch) <> '');
ALTER TABLE agentship_design.run ADD COLUMN git_default_branch text CHECK (git_default_branch IS NULL OR btrim(git_default_branch) <> '');
