import { useState, useRef, useEffect } from 'react'
import {
    Plus,
    Copy,
    RotateCcw,
    ArrowUp,
    PanelLeftClose,
    PanelLeftOpen,
    Pencil,
    Check,
    X,
    Trash2
} from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { supabase } from "@/lib/supabase"
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Message {
    role: 'user' | 'assistant'
    content: string
}

interface ChatSession {
    id: string
    title: string
    updated_at: string
}

function App() {
    const [session, setSession] = useState<any>(null)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [sessions, setSessions] = useState<ChatSession[]>([])
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isChatLoading, setIsChatLoading] = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(true)
    const [showProfileMenu, setShowProfileMenu] = useState(false)
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
    const [editTitle, setEditTitle] = useState('')
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
            if (session) loadSessions()
        })

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
            if (session) loadSessions()
        })

        return () => subscription.unsubscribe()
    }, [])

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages])

    const loadSessions = async () => {
        const { data, error } = await supabase
            .from('chat_sessions')
            .select('*')
            .order('updated_at', { ascending: false })

        if (!error && data) {
            setSessions(data)
            if (data.length > 0 && !currentSessionId) {
                loadSession(data[0].id)
            }
        }
    }

    const loadSession = async (sessionId: string) => {
        setCurrentSessionId(sessionId)
        const { data, error } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true })

        if (!error && data) {
            setMessages(data.map(msg => ({ role: msg.role, content: msg.content })))
        }
    }

    const createNewSession = async () => {
        const { data, error } = await supabase
            .from('chat_sessions')
            .insert({ user_id: session.user.id, title: 'New Chat' })
            .select()
            .single()

        if (!error && data) {
            setSessions([data, ...sessions])
            setCurrentSessionId(data.id)
            setMessages([])
        }
    }

    const startEditing = (sess: ChatSession, e: React.MouseEvent) => {
        e.stopPropagation()
        setEditingSessionId(sess.id)
        setEditTitle(sess.title)
    }

    const saveTitle = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const { error } = await supabase
            .from('chat_sessions')
            .update({ title: editTitle })
            .eq('id', sessionId)

        if (!error) {
            setSessions(sessions.map(s => s.id === sessionId ? { ...s, title: editTitle } : s))
            setEditingSessionId(null)
        }
    }

    const cancelEditing = (e: React.MouseEvent) => {
        e.stopPropagation()
        setEditingSessionId(null)
    }

    const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm('Are you sure you want to delete this chat?')) return

        const { error } = await supabase
            .from('chat_sessions')
            .delete()
            .eq('id', sessionId)

        if (!error) {
            const newSessions = sessions.filter(s => s.id !== sessionId)
            setSessions(newSessions)

            if (currentSessionId === sessionId) {
                if (newSessions.length > 0) {
                    loadSession(newSessions[0].id)
                } else {
                    setCurrentSessionId(null)
                    setMessages([])
                }
            }
        }
    }

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) alert(error.message)
        setLoading(false)
    }

    const handleSignUp = async () => {
        setLoading(true)
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) alert(error.message)
        else alert('Check your email for the login link!')
        setLoading(false)
    }

    const handleLogout = async () => {
        await supabase.auth.signOut()
        setSessions([])
        setMessages([])
        setCurrentSessionId(null)
        setShowProfileMenu(false)
    }

    const handleCopy = (content: string) => {
        navigator.clipboard.writeText(content)
    }

    const handleRetry = async () => {
        if (messages.length === 0 || isChatLoading) return

        // Find the last user message (compatible way)
        let lastUserMessageIndex = -1
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                lastUserMessageIndex = i
                break
            }
        }

        if (lastUserMessageIndex === -1) return

        const lastUserMessage = messages[lastUserMessageIndex]

        // Keep messages up to the last user message
        const newHistory = messages.slice(0, lastUserMessageIndex + 1)
        setMessages(newHistory)
        setIsChatLoading(true)

        try {
            const response = await fetch('http://localhost:8000/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: lastUserMessage.content,
                    history: newHistory.slice(0, -1), // Send history excluding the last message which is the current prompt
                    user_id: session?.user?.id,
                    session_id: currentSessionId
                }),
            })

            if (!response.ok) throw new Error('Failed to fetch response')

            const data = await response.json()
            const assistantMessage: Message = { role: 'assistant', content: data.response }
            setMessages(prev => [...prev, assistantMessage])

            if (currentSessionId) {
                // We should ideally delete the old assistant message from DB if we want true sync, 
                // but for now we just append the new one. 
                // A proper implementation would delete the failed/old response from DB.
                // For simplicity in this "MVP", we just insert the new one.
                await supabase.from('chat_messages').insert({
                    session_id: currentSessionId,
                    role: 'assistant',
                    content: assistantMessage.content
                })
                await supabase
                    .from('chat_sessions')
                    .update({ updated_at: new Date().toISOString() })
                    .eq('id', currentSessionId)
            }
        } catch (error) {
            console.error('Error:', error)
            setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }])
        } finally {
            setIsChatLoading(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || isChatLoading) return

        const userMessage: Message = { role: 'user', content: input }
        setMessages(prev => [...prev, userMessage])
        setInput('')
        setIsChatLoading(true)

        try {
            let sessionId = currentSessionId
            if (!sessionId) {
                const { data } = await supabase
                    .from('chat_sessions')
                    .insert({ user_id: session.user.id, title: input.slice(0, 50) })
                    .select()
                    .single()

                if (data) {
                    sessionId = data.id
                    setCurrentSessionId(sessionId)
                    setSessions([data, ...sessions])
                }
            }

            if (sessionId) {
                await supabase.from('chat_messages').insert({
                    session_id: sessionId,
                    role: 'user',
                    content: userMessage.content
                })
            }

            const response = await fetch('http://localhost:8000/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage.content,
                    history: messages,
                    user_id: session?.user?.id,
                    session_id: sessionId
                }),
            })

            if (!response.ok) throw new Error('Failed to fetch response')

            const data = await response.json()
            const assistantMessage: Message = { role: 'assistant', content: data.response }
            setMessages(prev => [...prev, assistantMessage])

            if (sessionId) {
                await supabase.from('chat_messages').insert({
                    session_id: sessionId,
                    role: 'assistant',
                    content: assistantMessage.content
                })
                await supabase
                    .from('chat_sessions')
                    .update({ updated_at: new Date().toISOString() })
                    .eq('id', sessionId)
            }
        } catch (error) {
            console.error('Error:', error)
            setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }])
        } finally {
            setIsChatLoading(false)
        }
    }

    if (!session) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
                <div className="w-full max-w-md p-8 space-y-8">
                    <div className="text-center space-y-2">
                        <div className="w-12 h-12 bg-primary rounded-xl mx-auto mb-6 flex items-center justify-center">
                            <span className="font-serif text-2xl text-primary-foreground font-bold">L</span>
                        </div>
                        <h1 className="text-3xl font-serif font-medium">Welcome back</h1>
                    </div>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <Input
                            type="email"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="h-12 bg-secondary border-transparent focus:border-primary/50 transition-colors"
                        />
                        <Input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="h-12 bg-secondary border-transparent focus:border-primary/50 transition-colors"
                        />
                        <Button type="submit" className="w-full h-12 text-base font-medium" disabled={loading}>
                            {loading ? 'Loading...' : 'Continue'}
                        </Button>
                    </form>
                    <div className="text-center">
                        <button onClick={handleSignUp} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                            Don't have an account? Sign up
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    const currentSessionTitle = sessions.find(s => s.id === currentSessionId)?.title || 'New Chat'

    return (
        <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans selection:bg-primary/20">
            {/* Sidebar Navigation */}
            <div className={`${sidebarOpen ? 'w-[260px]' : 'w-0'} bg-secondary/30 flex flex-col transition-all duration-300 ease-in-out relative border-r border-border/40`}>
                <div className="p-4 flex items-center justify-between">
                    <h2 className="font-serif font-medium text-lg tracking-tight">Legacy Assistant</h2>
                    <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="text-muted-foreground hover:text-foreground ml-auto h-6 w-6">
                        <PanelLeftClose className="w-4 h-4" />
                    </Button>
                </div>

                <div className="px-3 pb-4">
                    <Button onClick={createNewSession} className="w-full justify-start gap-2 h-10 bg-secondary text-foreground hover:bg-secondary/80 shadow-none border border-border/50 transition-all">
                        <Plus className="w-4 h-4" />
                        <span className="font-medium text-sm">New Chat</span>
                    </Button>
                </div>

                <ScrollArea className="flex-1 px-3">
                    <div className="space-y-0.5 py-2">
                        <div className="text-xs font-medium text-muted-foreground/60 px-2 py-2 uppercase tracking-wider">Recent</div>
                        {sessions.map((sess) => (
                            <div
                                key={sess.id}
                                className={`group w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${currentSessionId === sess.id
                                    ? 'bg-secondary/80 text-foreground font-medium'
                                    : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground'
                                    }`}
                                onClick={() => loadSession(sess.id)}
                            >
                                {editingSessionId === sess.id ? (
                                    <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
                                        <Input
                                            value={editTitle}
                                            onChange={e => setEditTitle(e.target.value)}
                                            className="h-6 text-xs px-1 py-0 bg-background border-primary/50"
                                            autoFocus
                                        />
                                        <Button size="icon" variant="ghost" className="h-6 w-6 hover:text-primary" onClick={(e) => saveTitle(sess.id, e)}>
                                            <Check className="w-3 h-3" />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="h-6 w-6 hover:text-destructive" onClick={cancelEditing}>
                                            <X className="w-3 h-3" />
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <span className="truncate flex-1 text-left">{sess.title}</span>
                                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                onClick={(e) => startEditing(sess, e)}
                                            >
                                                <Pencil className="w-3 h-3" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                                onClick={(e) => deleteSession(sess.id, e)}
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </ScrollArea>

                <div className="p-3 mt-auto relative border-t border-border/40">
                    {showProfileMenu && (
                        <div className="absolute bottom-full left-3 right-3 mb-2 bg-popover border border-border rounded-lg shadow-lg p-1 z-20">
                            <Button onClick={handleLogout} variant="ghost" size="sm" className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10">
                                <RotateCcw className="w-4 h-4" />
                                Sign out
                            </Button>
                        </div>
                    )}
                    <button
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-secondary/50 transition-colors text-left"
                    >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-primary-foreground text-xs font-bold ring-2 ring-background">
                            {session.user.email?.[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate text-foreground">{session.user.email}</div>
                        </div>
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col relative min-w-0 bg-background">
                {/* Top Bar */}
                <header className="h-14 flex items-center justify-between px-4 md:px-6 z-10 sticky top-0 bg-background/80 backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                        {!sidebarOpen && (
                            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="mr-2 text-muted-foreground hover:text-foreground">
                                <PanelLeftOpen className="w-4 h-4" />
                            </Button>
                        )}
                        <h2 className="font-medium text-sm text-foreground/80">
                            {currentSessionTitle}
                        </h2>
                    </div>
                </header>

                {/* Chat Area */}
                <ScrollArea className="flex-1">
                    <div className="max-w-3xl mx-auto px-4 py-8 md:py-12 space-y-8">
                        {messages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
                                <div className="w-16 h-16 bg-secondary/30 rounded-2xl flex items-center justify-center mb-4 text-primary ring-1 ring-primary/20">
                                    <span className="text-3xl">✨</span>
                                </div>
                                <h1 className="text-2xl font-serif font-medium text-foreground">
                                    Legacy Assistant
                                </h1>
                            </div>
                        ) : (
                            messages.map((msg, index) => (
                                <div key={index} className={`group flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    {/* Message Content */}
                                    <div className={`max-w-[85%] w-fit ${msg.role === 'user'
                                        ? 'bg-secondary/60 px-4 py-1.5 rounded-2xl text-foreground'
                                        : 'px-0 py-2'
                                        }`}>
                                        <div className={`prose prose-invert max-w-none ${msg.role === 'user' ? 'text-sm leading-relaxed' : 'text-foreground/90'}`}>
                                            {msg.role === 'assistant' ? (
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {msg.content}
                                                </ReactMarkdown>
                                            ) : (
                                                <p className="m-0">{msg.content}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Assistant Actions */}
                                    {msg.role === 'assistant' && (
                                        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity px-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-muted-foreground/60 hover:text-foreground"
                                                onClick={() => handleCopy(msg.content)}
                                            >
                                                <Copy className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-muted-foreground/60 hover:text-foreground"
                                                onClick={handleRetry}
                                            >
                                                <RotateCcw className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                        {isChatLoading && (
                            <div className="flex items-center gap-1 h-8 px-1">
                                <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        )}
                        <div ref={scrollRef} />
                    </div>
                </ScrollArea>

                {/* Input Area */}
                <div className="p-4 md:p-6 max-w-3xl mx-auto w-full">
                    <div className="bg-secondary/30 rounded-2xl p-3 focus-within:bg-secondary/50 transition-colors ring-1 ring-border/50 focus-within:ring-primary/30">
                        <form onSubmit={handleSubmit} className="relative">
                            <Input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="How can I help you today?"
                                disabled={isChatLoading}
                                className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none px-3 py-2 h-auto min-h-[44px] text-base resize-none shadow-none placeholder:text-muted-foreground/50"
                            />
                            <div className="flex items-center justify-between px-1 mt-2">
                                <div className="flex gap-1">
                                    {/* Left icons removed */}
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground/40 font-medium">Gemini 2.5 Flash</span>
                                    <Button
                                        type="submit"
                                        disabled={isChatLoading || !input.trim()}
                                        size="icon"
                                        className={`h-8 w-8 rounded-lg transition-all ${input.trim() ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90' : 'bg-secondary/50 text-muted-foreground'
                                            }`}
                                    >
                                        <ArrowUp className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </form>
                    </div>
                    <p className="text-center text-[10px] text-muted-foreground/40 mt-4">
                        Legacy Assistant can make mistakes. Please double-check responses.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default App
