#!/bin/bash
cd /home/kavia/workspace/code-generation/audioread-pro-95473-95490/audio_read_pro
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

