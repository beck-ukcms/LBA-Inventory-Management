#!/bin/bash

set -e

OUTPUT="PROJECT_SOURCE.txt"

: > "$OUTPUT"

echo "================================================================" >> "$OUTPUT"
echo "GIT COMMIT: $(git rev-parse HEAD)" >> "$OUTPUT"
echo "================================================================" >> "$OUTPUT"
echo "" >> "$OUTPUT"

git ls-tree -r --name-only HEAD |
while IFS= read -r file
do
    case "$file" in
        *.js|*.html|appsscript.json)
            echo "================================================================" >> "$OUTPUT"
            echo "FILE: $file" >> "$OUTPUT"
            echo "================================================================" >> "$OUTPUT"
            echo "" >> "$OUTPUT"

            git show "HEAD:$file" >> "$OUTPUT"

            echo "" >> "$OUTPUT"
            echo "" >> "$OUTPUT"
        ;;
    esac
done

echo "Created $OUTPUT from commit $(git rev-parse --short HEAD)"
