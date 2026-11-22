#!/bin/bash

OUTPUT="PROJECT_SOURCE.txt"

: > "$OUTPUT"

for file in *.js *.html appsscript.json
do
    if [ -f "$file" ]; then
        echo "================================================================" >> "$OUTPUT"
        echo "FILE: $file" >> "$OUTPUT"
        echo "================================================================" >> "$OUTPUT"
        echo "" >> "$OUTPUT"

        cat "$file" >> "$OUTPUT"

        echo "" >> "$OUTPUT"
        echo "" >> "$OUTPUT"
    fi
done
