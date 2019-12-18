#!/bin/bash

echo "Triggering Docker duild"
npm run build
docker build -q -t pbell722/citadel-service .
echo "Finished building docker image"