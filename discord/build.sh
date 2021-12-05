#!/bin/bash

# Create build/ folder
if [ ! -d build ]; then
    echo "Creating build/ folder"
    mkdir build
fi

# Build Lambda function zip
echo "Creating lambda_function.zip"
zip build/lambda_function.zip -j lambda_function.ts package.json tsconfig.json

# Build Lambda layer
echo "Creating layer.zip for Node.js 12.x"
zip -r layer.zip node_modules > /dev/null
ls -lah layer.zip
mv layer.zip ./build

echo "Saved lambda_function.zip and layer.zip to the build/ folder!"
