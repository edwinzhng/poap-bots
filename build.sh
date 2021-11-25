#!/bin/bash
if [ $# -eq 0 ]; then
	echo "Please enter Python version as argument:"
    echo "./build.sh [PYTHON_VERSION]"
    exit 1
fi

# Create build/ folder
if [ ! -d build ]; then
    echo "Creating build/ folder"
    mkdir build
fi

# Build Lambda function zip
echo "Creating lambda_function.zip"
zip build/lambda_function.zip -j lambda_function.py

# Build Lambda layer
echo "Creating layer.zip for Python version $1"
docker run -v "$PWD":/var/task "lambci/lambda:build-python$1" /bin/sh -c "pip install -r requirements.txt -t python/lib/python$1/site-packages/; exit"
zip -r layer.zip python > /dev/null
rm -r python
ls -lah layer.zip
mv layer.zip ./build

echo "Saved lambda_function.zip and layer.zip to the build/ folder!"
