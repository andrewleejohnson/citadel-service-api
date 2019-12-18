#!/bin/bash
dir=$(pwd)

echo $dir

echo "Launching docker image"
docker run -p 49161:8888 -v "$dir/src/config.json:/usr/src/app/dist/config.json" -d pbell722/citadel-service
echo "Done"