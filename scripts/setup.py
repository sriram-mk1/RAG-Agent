import os
import glob
import time
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone, ServerlessSpec
from supabase import create_client, Client

load_dotenv()

def setup_vector_db():
    print("Setting up Vector Database...")
    api_key = os.getenv("PINECONE_API_KEY")
    if not api_key:
        print("PINECONE_API_KEY not found.")
        return

    pc = Pinecone(api_key=api_key)
    index_name = os.getenv("PINECONE_INDEX_NAME", "legacy-rag-index")
    
    existing_indexes = [i.name for i in pc.list_indexes()]
    
    if index_name not in existing_indexes:
        print(f"Creating index {index_name}...")
        try:
            pc.create_index(
                name=index_name,
                dimension=768, # text-embedding-004 dimension
                metric="cosine",
                spec=ServerlessSpec(cloud="aws", region="us-east-1") # Defaulting to us-east-1 if not specified, or use env
            )
            # Wait for index to be ready
            while not pc.describe_index(index_name).status['ready']:
                time.sleep(1)
        except Exception as e:
            print(f"Error creating index: {e}")
    else:
        print(f"Index {index_name} already exists.")
    
    # Load Data
    print("Loading data from data/ directory...")
    documents = []
    data_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
    
    # Support multiple file types
    supported_extensions = ['*.txt', '*.pdf', '*.md', '*.docx', '*.doc']
    
    for ext in supported_extensions:
        for file_path in glob.glob(os.path.join(data_path, ext)):
            print(f"Loading {file_path}...")
            try:
                # Determine loader based on file extension
                file_ext = os.path.splitext(file_path)[1].lower()
                
                if file_ext == '.txt' or file_ext == '.md':
                    from langchain_community.document_loaders import TextLoader
                    loader = TextLoader(file_path, encoding='utf-8')
                elif file_ext == '.pdf':
                    from langchain_community.document_loaders import PyPDFLoader
                    loader = PyPDFLoader(file_path)
                elif file_ext in ['.docx', '.doc']:
                    from langchain_community.document_loaders import Docx2txtLoader
                    loader = Docx2txtLoader(file_path)
                else:
                    print(f"Unsupported file type: {file_ext}")
                    continue
                
                documents.extend(loader.load())
                print(f"✓ Loaded {file_path}")
            except Exception as e:
                print(f"✗ Error loading {file_path}: {e}")
    
    if not documents:
        print("No documents found in data/ directory.")
        return

    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    docs = text_splitter.split_documents(documents)
    
    print(f"Embedding {len(docs)} chunks...")
    embeddings = GoogleGenerativeAIEmbeddings(model="models/text-embedding-004")
    
    # Upsert to Pinecone
    try:
        PineconeVectorStore.from_documents(docs, embeddings, index_name=index_name)
        print("Vector Database Setup Complete.")
    except Exception as e:
        print(f"Error upserting to Pinecone: {e}")

def setup_supabase():
    print("Setting up Supabase Tables...")
    print("Please run the SQL migration manually in your Supabase SQL Editor:")
    print("Location: scripts/migration.sql")
    print("\nAlternatively, you can use the Supabase CLI to run migrations.")
    print("Note: The migration creates the chat_history table with RLS policies.")

if __name__ == "__main__":
    setup_vector_db()
    setup_supabase()
