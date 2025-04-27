from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from gtts import gTTS
import base64
from io import BytesIO
import os
from pathlib import Path
import google.generativeai as genai
import json
from uuid import uuid4
from typing import Dict, List, Optional
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from elevenlabs import save

# Load environment variables
load_dotenv()

app = FastAPI()

# Enable CORS for frontend at localhost:3000
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directory to store generated voice files
VOICES_DIR = Path("generated_voices")
VOICES_DIR.mkdir(exist_ok=True)

# JSON file to persist user sessions
SESSION_FILE = Path("session.json")
if not SESSION_FILE.exists():
    with open(SESSION_FILE, "w") as f:
        json.dump({"sessions": {}}, f)

# Voice IDs for ElevenLabs voices
MIKE_VOICE_ID = "CwhRBWXzGAHq8TQ4Fs17"
MILEY_VOICE_ID = "9BWtsMINqrJLrRacOk9x"

# Initialize ElevenLabs and Gemini clients
eleven_client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_model = genai.GenerativeModel('gemini-1.5-flash')

# Input model for agent request
class Message(BaseModel):
    speaker: str
    text: str

class ArticleDescription(BaseModel):
    type: str
    content: str

class ArticleContent(BaseModel):
    title: str
    description: List[ArticleDescription] = []
    code: str = ""
    language: str = ""

class AgentRequest(BaseModel):
    user_name: str = "User"
    user_input: str
    topic: str = "general"
    step: int = 0
    mike_voice_id: str = MIKE_VOICE_ID
    miley_voice_id: str = MILEY_VOICE_ID
    session_id: Optional[str] = ""
    article_content: Optional[ArticleContent] = None

# Output model for agent response
class AgentResponse(BaseModel):
    agentA_message: str
    agentB_message: str
    agentA_voice: str
    agentB_voice: str
    session_id: Optional[str] = ""

# Load sessions from disk
def load_sessions() -> Dict:
    with open(SESSION_FILE, "r") as f:
        return json.load(f)

# Save sessions to disk
def save_sessions(sessions: Dict):
    with open(SESSION_FILE, "w") as f:
        json.dump({"sessions": sessions}, f, indent=2)

# Convert text to speech and return base64-encoded MP3
def generate_voice(text: str, voice_id: str, filename: str = None) -> str:
    try:
        audio_gen = eleven_client.text_to_speech.convert(
            text=text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )
        audio_bytes = b"".join(audio_gen)

        if filename:
            save_path = VOICES_DIR / f"{filename}.mp3"
            save(audio_bytes, str(save_path))

        buf = BytesIO()
        buf.write(audio_bytes)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode("utf-8")

    except Exception as e:
        print(f"ElevenLabs error, falling back to gTTS: {e}")
        tts = gTTS(text=text, lang="en")
        buf = BytesIO()
        tts.write_to_fp(buf)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode("utf-8")

# Format article content for the AI prompt based on what's available
def format_article_content(article_content: ArticleContent, step: int) -> str:
    if not article_content:
        return ""
    
    result = f"ARTICLE TITLE: {article_content.title}\n\n"
    
    if article_content.description:
        result += "ARTICLE CONTENT:\n"
        for item in article_content.description:
            result += f"{item.type}: {item.content}\n"
    
    if article_content.code and article_content.language:
        result += f"\nCODE ({article_content.language}):\n{article_content.code}"
    
    # Add a prompt hint based on what content is available at this step
    if step == 0:
        result += "\n\nNote: At this point, we're just introducing the topic title."
    elif step == 1:
        result += "\n\nNote: At this point, we've introduced the first part of the article."
    elif step == 2:
        result += "\n\nNote: At this point, we've covered the full article text but not the code yet."
    else:
        result += "\n\nNote: At this point, we've covered the full article and code."
        
    return result

# Generate dialog using Gemini with prior message context
def generate_with_gemini(history: List[Message], topic: str, article_content: Optional[ArticleContent], user_name: str, step: int) -> tuple:
    history_str = "\n".join([f"{msg.speaker}: {msg.text}" for msg in history[-6:]])
    
    # Format article content for the prompt based on current step
    article_text = format_article_content(article_content, step) if article_content else ""
    
    # Customize prompt based on conversation step
    if step == 0:
        prompt = f"""
        Start a conversation with a user about {topic}.
        
        Article information to discuss:
        {article_text}
        
        Generate exactly two responses:
        1. Mike's response (1-2 sentences): A friendly welcome and introduction to the topic title
        2. Miley's response (1-2 sentences): A friendly follow-up that asks the user for their name
        
        Format exactly like:
        Mike: [message]
        Miley: [message]
        """
    elif step == 1:
        prompt = f"""
        Continue this conversation about {topic}. The user has just provided their name: {user_name}.
        
        Article information to discuss:
        {article_text}
        
        Previous messages:
        {history_str}
        
        Generate exactly two responses:
        1. Mike's response (1-2 sentences): Greet the user by name and mention the first piece of article content
        2. Miley's response (1-2 sentences): Add to Mike's point or ask a question about the user's interest in the topic
        
        Format exactly like:
        Mike: [message]
        Miley: [message]
        """
    elif step == 2:
        prompt = f"""
        Continue this conversation with {user_name} about {topic}.
        
        Article information to discuss:
        {article_text}
        
        Previous messages:
        {history_str}
        
        User's latest input: {history[-1].text if history else ""}
        
        Generate exactly two responses:
        1. Mike's response (1-2 sentences): Comment on the article overview section
        2. Miley's response (1-2 sentences): Ask the user if they're familiar with the topic
        
        Format exactly like:
        Mike: [message]
        Miley: [message]
        """
    elif step == 3:
        prompt = f"""
        Continue this conversation with {user_name} about {topic}.
        
        Article information to discuss:
        {article_text}
        
        Previous messages:
        {history_str}
        
        User's latest input: {history[-1].text if history else ""}
        
        Generate exactly two responses:
        1. Mike's response (1-2 sentences): Introduce the code example and explain what it does at a high level
        2. Miley's response (1-2 sentences): Point out a specific interesting part of the code
        
        Format exactly like:
        Mike: [message]
        Miley: [message]
        """
    else:
        prompt = f"""
        Continue this conversation with {user_name} about {topic}.
        
        Article information to discuss:
        {article_text}
        
        Previous messages:
        {history_str}
        
        User's latest input: {history[-1].text if history else ""}
        
        Generate exactly two responses that directly address the user's input:
        1. Mike's response (1-2 sentences): Provide insight or explanation about the code or article
        2. Miley's response (1-2 sentences): Add a complementary point or ask a follow-up question
        
        Format exactly like:
        Mike: [message]
        Miley: [message]
        """
    
    response = gemini_model.generate_content(prompt)
    text = response.text

    mike_msg = ""
    miley_msg = ""
    for line in text.split('\n'):
        if line.startswith("Mike:"):
            mike_msg = line[5:].strip()
        elif line.startswith("Miley:"):
            miley_msg = line[7:].strip()
    
    return mike_msg, miley_msg

# Main endpoint for generating agent conversation and audio
@app.post("/agents/discuss", response_model=AgentResponse)
async def agent_discussion(req: AgentRequest):
    sessions = load_sessions()["sessions"]

    # Start a new session if not provided
    if not req.session_id or req.session_id not in sessions:
        req.session_id = str(uuid4())
        sessions[req.session_id] = {
            "history": [],
            "topic": req.topic,
            "user_name": req.user_name,
            "step": 0,
            "article_content_history": []
        }

    session = sessions[req.session_id]

    # Update user name if provided and not already set
    if req.user_name and req.user_name != "User":
        session["user_name"] = req.user_name

    # Add user's message to session history if provided
    if req.user_input:
        session["history"].append({
            "speaker": session.get("user_name", "User"),
            "text": req.user_input
        })

    # Store the article content for this step if provided
    if req.article_content:
        # Save this step's article content in history
        session["article_content_history"].append(req.article_content.dict())
        
    # Get the current article content
    article_content = None
    if session.get("article_content_history"):
        # Use the most recent article content
        article_content = ArticleContent(**session["article_content_history"][-1])

    # Use the step from the request or the session
    current_step = req.step if req.step is not None else session.get("step", 0)
    
    # Generate Gemini-based agent messages
    history = [Message(**msg) for msg in session["history"]]
    mike_msg, miley_msg = generate_with_gemini(
        history, 
        req.topic, 
        article_content, 
        session.get("user_name", "User"),
        current_step
    )

    # Add agent messages to history
    session["history"].extend([
        {"speaker": "Mike", "text": mike_msg},
        {"speaker": "Miley", "text": miley_msg}
    ])

    # Update the step in the session
    session["step"] = current_step + 1

    # Save updated session
    save_sessions(sessions)

    # Generate voices for agent responses
    try:
        mike_voice = generate_voice(mike_msg, req.mike_voice_id)
        miley_voice = generate_voice(miley_msg, req.miley_voice_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS error: {e}")

    return AgentResponse(
        agentA_message=mike_msg,
        agentB_message=miley_msg,
        agentA_voice=mike_voice,
        agentB_voice=miley_voice,
        session_id=req.session_id
    )

# Optional: Save sessions on shutdown (extendable for cleanup)
@app.on_event("shutdown")
def cleanup_sessions():
    sessions = load_sessions()
    save_sessions(sessions)