import os
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.chains import create_history_aware_retriever, create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
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
    
    embeddings = GoogleGenerativeAIEmbeddings(model="models/text-embedding-005")
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

def get_retrieval_chain():
    # 1. Contextualize question
    contextualize_q_system_prompt = """Given a chat history and the latest user question \
    which might reference context in the chat history, formulate a standalone question \
    which can be understood without the chat history. Do NOT answer the question, \
    just reformulate it if needed and otherwise return it as is."""
    
    contextualize_q_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", contextualize_q_system_prompt),
            MessagesPlaceholder("chat_history"),
            ("human", "{input}"),
        ]
    )
    
    history_aware_retriever = create_history_aware_retriever(
        llm, vectorstore.as_retriever(), contextualize_q_prompt
    )
    
    # 2. Answer question
    qa_system_prompt = """You are an expert assistant for a legacy system called 'Legacy Payment Processor V1'. \
    Use the following pieces of retrieved context to answer the question. \
    If you don't know the answer, say that you don't know. \
    Use three sentences maximum and keep the answer concise. \
    
    {context}"""
    
    qa_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", qa_system_prompt),
            MessagesPlaceholder("chat_history"),
            ("human", "{input}"),
        ]
    )
    
    question_answer_chain = create_stuff_documents_chain(llm, qa_prompt)
    
    rag_chain = create_retrieval_chain(history_aware_retriever, question_answer_chain)
    return rag_chain

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
        
        chain = get_retrieval_chain()
        
        response = chain.invoke({"input": request.message, "chat_history": chat_history})
        answer = response["answer"]
        
        # Save to Supabase (Async in real app, sync here for simplicity)
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
        
        return ChatResponse(response=answer)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "ok"}
