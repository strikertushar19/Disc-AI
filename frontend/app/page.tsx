"use client";
import { useState, useRef } from 'react';
import { Copy, Mic, MicOff, Volume2, VolumeX, MessageCircle, Code, BookOpen, Bot } from 'lucide-react';

const CodeWithDiscussion = () => {
  const [content] = useState({
    title: "Building a REST API in Go",
    description: [
      { type: "p", content: "This example demonstrates how to build a simple REST API using the Gin web framework in Go." },
      { type: "h2", content: "Overview" },
      { type: "p", content: "We'll define a GET endpoint that returns a JSON response when accessed." }
    ],
    code: `package main

import (
    "github.com/gin-gonic/gin"
    "net/http"
)

func main() {
    router := gin.Default()

    router.GET("/ping", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{
            "message": "pong",
        })
    })

    router.Run(":8080")
}`,
    language: "go"
  });

  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState(0);
  const [userName, setUserName] = useState('');
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [started, setStarted] = useState(false);
  const [canInput, setCanInput] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('code');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const chatContainerRef = useRef(null);

  const agentA = "Mike";
  const agentB = "Mily";

  // Function to determine which content to send based on the current step
  const getStepContent = () => {
    // Step 0: Send just the title
    if (step === 0) {
      return {
        title: content.title,
        description: [],
        code: "",
        language: ""
      };
    }
    // Step 1: Send the title and first description item
    else if (step === 1) {
      return {
        title: content.title,
        description: [content.description[0]],
        code: "",
        language: ""
      };
    }
    // Step 2: Send title and all description items
    else if (step === 2) {
      return {
        title: content.title,
        description: content.description,
        code: "",
        language: ""
      };
    }
    // Step 3 and beyond: Send everything including code
    else {
      return {
        title: content.title,
        description: content.description,
        code: content.code,
        language: content.language
      };
    }
  };

  const playAudio = (base64Audio) => {
    return new Promise((resolve) => {
      const audioSrc = `data:audio/mp3;base64,${base64Audio}`;
      const audio = new Audio(audioSrc);
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
  };

  const fetchAgentResponse = async () => {
    try {
      setIsLoading(true);
      setCanInput(false);

      // Get the appropriate content for the current step
      const currentContent = getStepContent();

      const response = await fetch(`http://localhost:8000/agents/discuss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          user_name: userName || "User", 
          step, 
          user_input: userInput.trim(),
          topic: content.title,
          session_id: sessionId || "",
          article_content: currentContent
        }),
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const data = await response.json();
      const newMessages = [];

      if (data.agentA_message) newMessages.push(`${agentA}: ${data.agentA_message}`);
      if (data.agentB_message) newMessages.push(`${agentB}: ${data.agentB_message}`);

      setMessages(prev => [...prev, ...newMessages]);

      // Store session ID for future requests
      if (data.session_id) {
        setSessionId(data.session_id);
      }

      if (!isMuted) {
        if (data.agentA_voice) await playAudio(data.agentA_voice);
        if (data.agentB_voice) await playAudio(data.agentB_voice);
      }

      setStep(prev => prev + 1);
      setCanInput(true);
      
      // Scroll chat to bottom
      if (chatContainerRef.current) {
        setTimeout(() => {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }, 100);
      }
    } catch (error) {
      console.error('Error fetching from API:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStart = () => {
    setStarted(true);
    fetchAgentResponse();
  };

  const handleUserSubmit = () => {
    if (!userInput.trim()) return;

    if (step === 1) {
      setUserName(userInput.trim());
    }
    
    setMessages(prev => [...prev, `You: ${userInput.trim()}`]);
    fetchAgentResponse();
    setUserInput('');
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        setIsLoading(true);
        setTimeout(() => {
          setUserInput("This is what I said via voice input");
          setIsLoading(false);
        }, 1000);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error accessing microphone:", error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(content.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col justify-center text-style1  items-center bg-gradient-to-br from-green-500 to-green-600  text-white min-h-screen py-8">
      {/* App Header */}
      <div className="w-full max-w-6xl mb-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Bot size={64} className="text-white" />
          <h1 className="text-7xl font-bold text-white  bg-clip-text">Disc AI</h1>
        </div>
        <p className="text-white text-3xl font-bold">Interactive  learning  platform with AI-powered discussions with Mike and Mily</p>
      </div>
       

      {/* Main App Container */}
      <div className="w-full max-w-7xl  rounded-xl from-green-800 to-green-900 overflow-hidden  border-shadow-lg border-amber-50 border">
        {!started ? (
          <div className="flex flex-col items-center justify-center py-32 px-4 space-y-6 bg-gradient-to-br from-green-800 to-green-900">
            <Bot size={64} className="text-white mb-4" />
            <h2 className="text-8xl text-style1 font-bold text-center text-white  bg-clip-text">
              Welcome to Disc AI
            </h2>
            <p className="text-white text-center max-w-md font-bold">
              Learn any concepts through interactive discussions with AI assistants that explain concepts and answer your questions.
            </p>
            <button
              onClick={handleStart}
              className="px-8 py-3 bg-white rounded-lg text-black  font-bold hover:opacity-90 transition-all transform hover:scale-105 shadow-lg"
            >
              Start Learning
            </button>
          </div>
        ) : (
          <div className="flex flex-col md:flex-row h-full border-amber-50 border-2">
            {/* Left sidebar - Agent A */}
            <div className="w-full md:w-1/4 bg-white p-4 border-r border-gray-700">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                    {agentA.charAt(0)}
                  </div>
                  <span className="font-semibold text-blue-400">{agentA}</span>
                </div>
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="text-black hover:text-blue-400 transition-colors"
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              </div>
              <div className="space-y-3 overflow-y-auto max-h-96">
                {messages
                  .filter(msg => msg.startsWith(agentA))
                  .map((msg, idx) => (
                    <div key={idx} className="p-3 bg-yellow rounded-lg text-black text-sm">
                      {msg.replace(`${agentA}: `, '')}
                    </div>
                  ))}
              </div>
            </div>

            {/* Center content area */}
            <div className="flex-1 flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-gray-700">
                <button 
                  onClick={() => setActiveTab('code')}
                  className={`flex items-center gap-2 px-6 py-3 ${activeTab === 'code' ? 'border-b-2 border-blue-500 text-white-400' : 'text-black'}`}
                >
                  <Code size={18} />
                  <span>Code</span>
                </button>
                <button 
                  onClick={() => setActiveTab('article')}
                  className={`flex items-center gap-2 px-6 py-3 ${activeTab === 'article' ? 'border-b-2 border-blue-500 text-white-400' : 'text-black'}`}
                >
                  <BookOpen size={18} />
                  <span>Article</span>
                </button>
                <button 
                  onClick={() => setActiveTab('chat')}
                  className={`flex items-center gap-2 px-6 py-3 ${activeTab === 'chat' ? 'border-b-2 border-blue-500 text-white-400' : 'text-black'}`}
                >
                  <MessageCircle size={18} />
                  <span>Discussion</span>
                </button>
              </div>

              {/* Content based on active tab */}
              <div className="flex-1 overflow-y-auto p-6">
                {activeTab === 'code' && (
                  <div className="bg-white rounded-lg overflow-hidden">
                    <div className="flex justify-between items-center p-4 bg-yellow">
                      <h2 className="font-semibold text-black">{content.title}</h2>
                      <button
                        onClick={copyToClipboard}
                        className="flex items-center gap-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors text-sm"
                      >
                        <Copy size={14} /> {copied ? "Copied!" : "Copy Code"}
                      </button>
                    </div>
                    <pre className="overflow-x-auto p-4 text-black bg-white rounded-b-lg text-sm">
                      <code className={`language-${content.language}`}>{content.code}</code>
                    </pre>
                  </div>
                )}

                {activeTab === 'article' && (
                  <div className="bg-white rounded-lg p-6">
                    <h1 className="text-2xl font-bold mb-4 text-blue-400">{content.title}</h1>
                    <div className="space-y-4 text-black">
                      {content.description.map((item, index) => {
                        switch (item.type) {
                          case 'h2': return <h2 key={index} className="text-xl font-semibold text-black mt-6">{item.content}</h2>;
                          case 'h3': return <h3 key={index} className="text-lg font-medium text-black mt-4">{item.content}</h3>;
                          default: return <p key={index} className="text-black leading-relaxed">{item.content}</p>;
                        }
                      })}
                    </div>
                  </div>
                )}

                {activeTab === 'chat' && (
                  <div ref={chatContainerRef} className="bg-white rounded-lg p-4 space-y-3 max-h-96 overflow-y-auto">
                    {messages.map((message, idx) => {
                      const isUser = message.startsWith('You:');
                      const isAgentA = message.startsWith(agentA);
                      const isAgentB = message.startsWith(agentB);
                      
                      let avatarClass = "bg-gray-600";
                      let bgClass = "bg-yellow";
                      let alignClass = "justify-start";
                      let textAlign = "text-left";
                      
                      if (isUser) {
                        avatarClass = "bg-green-600";
                        bgClass = "bg-green-900/30";
                        alignClass = "justify-end";
                        textAlign = "text-right";
                      } else if (isAgentA) {
                        avatarClass = "bg-blue-600";
                        bgClass = "bg-blue-900/30";
                      } else if (isAgentB) {
                        avatarClass = "bg-purple-600";
                        bgClass = "bg-purple-900/30";
                      }
                      
                      const name = isUser ? 'You' : isAgentA ? agentA : agentB;
                      const content = message.replace(`${name}: `, '');
                      
                      return (
                        <div key={idx} className={`flex ${alignClass}`}>
                          <div className={`max-w-3/4 flex ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start gap-2`}>
                            <div className={`w-8 h-8 rounded-full ${avatarClass} flex items-center justify-center flex-shrink-0`}>
                              {name.charAt(0)}
                            </div>
                            <div className={`p-3 rounded-lg ${bgClass} ${textAlign}`}>
                              <div className="font-medium text-xs mb-1">{name}</div>
                              <div className="text-sm text-black">{content}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {isLoading && (
                      <div className="flex items-center gap-2 text-black">
                        <div className="animate-pulse flex space-x-1">
                          <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animation-delay-200"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animation-delay-400"></div>
                        </div>
                        <span>Thinking...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="p-4 border-t border-gray-700 bg-yellow">
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 px-4 py-3 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
                    placeholder={step === 1 ? "Enter your name..." : "Your response..."}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && canInput && handleUserSubmit()}
                    disabled={isLoading || isRecording || !canInput}
                  />
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`p-3 rounded-lg flex items-center justify-center ${
                      isRecording 
                        ? 'bg-red-500 hover:bg-red-600' 
                        : 'bg-gray-700 hover:bg-gray-600 border border-gray-600'
                    } transition-colors`}
                    disabled={isLoading}
                  >
                    {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                  <button
                    onClick={handleUserSubmit}
                    className="px-6 py-3 bg-white text-black rounded-lg font-medium hover:opacity-90 transition-colors disabled:opacity-50"
                    disabled={isLoading || isRecording || !canInput || !userInput.trim()}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>

            {/* Right sidebar - Agent B */}
            <div className="w-full md:w-1/4 bg-white p-4 border-l border-gray-700">
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-700">
                <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                  {agentB.charAt(0)}
                </div>
                <span className="font-semibold text-purple-400">{agentB}</span>
              </div>
              <div className="space-y-3 overflow-y-auto max-h-96">
                {messages
                  .filter(msg => msg.startsWith(agentB))
                  .map((msg, idx) => (
                    <div key={idx} className="p-3 bg-yellow rounded-lg text-black text-sm">
                      {msg.replace(`${agentB}: `, '')}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CodeWithDiscussion;