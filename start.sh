#!/bin/bash

# Start both frontend and backend servers

echo "🚀 Starting RAG Agent..."
echo ""

# Start backend in background
echo "📦 Starting backend server..."
source .venv/bin/activate && uvicorn backend.main:app --reload &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend
echo "🎨 Starting frontend server..."
cd frontend && npm run dev

# Cleanup on exit
trap "kill $BACKEND_PID 2>/dev/null" EXIT
