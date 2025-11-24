import os
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser
from langchain_core.messages import HumanMessage, AIMessage
from pinecone import Pinecone
from supabase import create_client, Client

load_dotenv()

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Clients
try:
    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    index_name = os.getenv("PINECONE_INDEX_NAME", "legacy-rag-index")
    index = pc.Index(index_name)
    
    embeddings = GoogleGenerativeAIEmbeddings(model="models/text-embedding-004")
    vectorstore = PineconeVectorStore(index=index, embedding=embeddings)
    
    llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0)
    
    supabase: Client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SECRET_KEY"))
    
except Exception as e:
    print(f"Error initializing services: {e}")
    # In production, you might want to crash or handle this more gracefully
    pass

class ChatRequest(BaseModel):
    message: str
    history: List[dict] # List of {role: str, content: str}
    user_id: str
    session_id: str

class ChatResponse(BaseModel):
    response: str

def get_rag_response(question: str, chat_history: List):
    """Simple RAG implementation with enhanced formatting"""
    # Get relevant documents
    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
    docs = retriever.invoke(question)
    
    # Format context
    context = "\n\n".join([doc.page_content for doc in docs])
    
    # Create enhanced prompt for better responses
    system_prompt = f"""You are a helpful and friendly expert assistant for legacy systems documentation.

Use the following context to answer the user's question:

{context}

Guidelines:
- Be conversational and helpful, like a senior engineer explaining to a colleague.
- Answer ONLY based on the provided context. If you don't know, just say so politely.
- Keep it concise and easy to read. Use markdown (bullets, `code`) where helpful.
- Avoid unnecessary fluff, but don't be robotic.

Format your response to be easily scannable."""
    
    messages = [("system", system_prompt)]
    
    # Add chat history
    for msg in chat_history:
        if isinstance(msg, HumanMessage):
            messages.append(("human", msg.content))
        elif isinstance(msg, AIMessage):
            messages.append(("assistant", msg.content))
    
    # Add current question
    messages.append(("human", question))
    
    # Get response
    prompt = ChatPromptTemplate.from_messages(messages)
    chain = prompt | llm | StrOutputParser()
    response = chain.invoke({})
    
    return response

@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    try:
        # Convert history to LangChain format
        chat_history = []
        for msg in request.history:
            if msg['role'] == 'user':
                chat_history.append(HumanMessage(content=msg['content']))
            elif msg['role'] == 'assistant':
                chat_history.append(AIMessage(content=msg['content']))
        
        answer = get_rag_response(request.message, chat_history)
        
        # Save to Supabase (only if user is authenticated)
        try:
            if request.user_id and request.user_id != 'test':
                # Save User Message
                supabase.table("chat_history").insert({
                    "user_id": request.user_id,
                    "session_id": request.session_id,
                    "role": "user",
                    "content": request.message
                }).execute()
                
                # Save Assistant Message
                supabase.table("chat_history").insert({
                    "user_id": request.user_id,
                    "session_id": request.session_id,
                    "role": "assistant",
                    "content": answer
                }).execute()
        except Exception as db_error:
            # Log but don't fail the request if DB save fails
            print(f"Warning: Failed to save to database: {db_error}")
        
        return ChatResponse(response=answer)
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "ok"}
