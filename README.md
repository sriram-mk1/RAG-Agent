# Legacy RAG Agent

AI-powered assistant for legacy code documentation using RAG (Retrieval-Augmented Generation).

## Features

- **React Frontend** with Shadcn/ui components
- **Python Backend** with FastAPI and LangChain
- **Vector Database** using Pinecone
- **LLM** powered by Google's Gemini 2.5 Flash
- **Embeddings** using Google's text-embedding-005
- **Authentication & Chat History** via Supabase

## Setup

### Prerequisites

- Python 3.9+
- Node.js 18+
- Pinecone account
- Supabase account
- Google AI API key

### 1. Environment Variables

**Backend** - Copy `.env.example` to `.env` and fill in:

```env
GOOGLE_API_KEY=your_google_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_ENV=your_pinecone_env
PINECONE_INDEX_NAME=legacy-rag-index
SUPABASE_URL=your_supabase_url
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key  # New API key format
SUPABASE_SECRET_KEY=your_supabase_secret_key            # New API key format
```

**Frontend** - Copy `frontend/.env.example` to `frontend/.env`:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key  # New API key format
```

> **Note**: Supabase has updated their API keys. Use the new `sb_publishable_...` and `sb_secret_...` keys instead of the legacy `anon` and `service_role` keys.

### 2. Install Dependencies

**Backend:**
```bash
pip install -r backend/requirements.txt
```

**Frontend:**
```bash
cd frontend
npm install
```

### 3. Initialize System

**Create Vector Database and Ingest Data:**
```bash
python scripts/setup.py
```

This will:
- Create a Pinecone index (768 dimensions for text-embedding-005)
- Process documents from the `/data` directory
- Embed and upload them to Pinecone

**Setup Supabase Database:**

Run the SQL migration in your Supabase SQL Editor:
- File: `scripts/migration.sql`
- This creates the `chat_history` table with Row Level Security policies

### 4. Add Your Documentation

Place your legacy documentation files in the `/data` directory. Supported formats:
- `.txt` - Plain text files
- `.pdf` - PDF documents
- `.md` - Markdown files
- `.docx` / `.doc` - Microsoft Word documents

Then run:
```bash
python scripts/setup.py
```

### 5. Run the Application

**Backend:**
```bash
uvicorn backend.main:app --reload
```
Backend runs on `http://localhost:8000`

**Frontend:**
```bash
cd frontend
npm run dev
```
Frontend runs on `http://localhost:5173`

## Usage

1. Sign up or sign in with email/password
2. Ask questions about your legacy system documentation
3. The AI will retrieve relevant context and provide concise answers
4. Chat history is automatically saved to Supabase

## Architecture

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: FastAPI + LangChain + Google Gemini
- **Vector DB**: Pinecone (768-dim embeddings)
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth

## RAG Chain

The system uses a history-aware retriever with:
1. Question contextualization from chat history
2. Semantic search in Pinecone
3. Context-aware answer generation with Gemini 2.5 Flash

## Migration for Others

This project is designed for easy migration:
1. Update `.env` files with your API keys
2. Run `python scripts/setup.py`
3. Run the SQL migration in Supabase
4. Start the application

No code changes needed!
