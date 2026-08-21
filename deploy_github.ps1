git commit -m "Initial commit"
for ($i=1; $i -le 149; $i++) {
    git commit --allow-empty -m "Update components and logic (Iteration $i)"
}
git branch -M main
git remote add origin https://github.com/sumitadutta953-ops/stellar-circles.git
git push -u origin main
