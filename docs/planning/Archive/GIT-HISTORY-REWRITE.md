# Git History Rewrite — Pre-Public-Release

Run these commands on `DevenDucommun/kai` BEFORE transferring to `kai-cli/kai`.

**Do not run on `DevenDucommun/pai-config` (personal repo) — that history stays private.**

---

## Prerequisites

```bash
pip install git-filter-repo
# or: brew install git-filter-repo
```

## Step 1: Clone a fresh copy to rewrite

```bash
git clone https://github.com/DevenDucommun/kai ~/kai-rewrite
cd ~/kai-rewrite
```

## Step 2: Purge credential values from all historical blobs

```bash
# Remove AWS account ID and profile name that appeared in old config/preferences.jsonc
git filter-repo --replace-text <(cat <<'EOF'
799870512242==>REDACTED-AWS-ACCOUNT
Deven_Ducommun==>your-aws-profile
dducommun@linksys.com==>maintainer@kai-cli.com
EOF
)
```

## Step 3: Rewrite author/committer identity

```bash
git filter-repo --email-callback '
    return b"maintainer@kai-cli.com"
' --name-callback '
    return b"KAI Maintainer"
'
```

## Step 4: Verify the rewrite

```bash
# Confirm old email gone
git log --all --format='%ae' | sort -u

# Confirm old AWS account ID gone from all blobs
git grep "799870512242" $(git rev-list --all) 2>/dev/null | wc -l
# Should be 0

# Confirm old profile name gone
git grep "Deven_Ducommun" $(git rev-list --all) 2>/dev/null | wc -l
# Should be 0
```

## Step 5: Force-push to DevenDucommun/kai

```bash
git remote set-url origin https://github.com/DevenDucommun/kai.git
git push --force --all
git push --force --tags
```

## Step 6: Transfer to kai-cli/kai

After validation (other tools, manual review):

1. GitHub Settings → Transfer repository → `kai-cli` org
2. Update install URL in `install.sh` and `README.md` if not already done
3. Set repo visibility to Public
4. Delete `DevenDucommun/kai` (GitHub will redirect for a period)

---

## Notes

- `git filter-repo` rewrites all commit SHAs — this breaks any existing clones
- Run only once, on the final pre-public state
- After transfer, the personal `DevenDucommun/pai-config` is completely unaffected
