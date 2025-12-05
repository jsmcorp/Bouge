import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ThumbsUp, Eye, MessageCircle, MoreVertical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/chatStore';
import { ChatInput } from '@/components/chat/ChatInput';
import { MessageList } from '@/components/chat/MessageList';
import { toast } from 'sonner';

// Helper function to format timestamp
function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    const month = date.toLocaleString('en-US', { month: 'short' });
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day}, ${year}`;
}

// Helper function to format view count
function formatViewCount(count: number): string {
    if (count < 1000) return count.toString();
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    return `${Math.floor(count / 1000)}k`;
}

// Helper function to get tag color based on topic type
function getTagColor(type: string): string {
    switch (type) {
        case 'news':
            return 'bg-purple-200 text-purple-900';
        case 'poll':
            return 'bg-orange-200 text-orange-900';
        case 'confession':
            return 'bg-pink-200 text-pink-900';
        case 'image':
            return 'bg-blue-200 text-blue-900';
        default:
            return 'bg-lime-200 text-lime-900';
    }
}

// Helper function to get tag label
function getTagLabel(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
}

export default function TopicChatPage() {
    const { groupId, topicId } = useParams();
    const navigate = useNavigate();
    const {
        groups,
        activeGroup,
        topics,
        messages,
        setActiveGroup,
        setMessages,
        setActiveTopicId,
        fetchGroups,
        getTopicMessages,
        toggleTopicLike,
        markTopicAsRead,
    } = useChatStore();

    const [isLoadingMessages, setIsLoadingMessages] = useState(false);

    // Find the current topic
    const topic = topics.find(t => t.id === topicId);

    // Set active group when groupId changes
    useEffect(() => {
        if (!groupId) return;

        const group = groups.find(g => g.id === groupId);
        if (group && (!activeGroup || activeGroup.id !== group.id)) {
            setActiveGroup(group);
        }
    }, [groupId, groups, activeGroup, setActiveGroup]);

    // Load groups if not loaded
    useEffect(() => {
        if (groups.length === 0) {
            fetchGroups();
        }
    }, [groups.length, fetchGroups]);

    // Set active topic ID
    useEffect(() => {
        if (topicId) {
            setActiveTopicId(topicId);
        }
        return () => {
            setActiveTopicId(null);
        };
    }, [topicId, setActiveTopicId]);

    // Load topic messages
    useEffect(() => {
        if (!topicId) return;

        const loadMessages = async () => {
            setIsLoadingMessages(true);
            try {
                const msgs = await getTopicMessages(topicId);
                // Set messages in the store so MessageList can display them
                setMessages(msgs);
            } catch (error) {
                console.error('Error loading topic messages:', error);
                toast.error('Failed to load messages');
            } finally {
                setIsLoadingMessages(false);
            }
        };

        loadMessages();
    }, [topicId, getTopicMessages, setMessages]);

    // Mark topic as read when viewing
    useEffect(() => {
        if (!topicId || messages.length === 0) return;

        const lastMessage = messages[messages.length - 1];
        if (lastMessage) {
            markTopicAsRead(topicId, lastMessage.id);
        }
    }, [topicId, messages, markTopicAsRead]);

    const handleBack = () => {
        navigate(`/groups/${groupId}`);
    };

    const handleLikeClick = async () => {
        if (!topicId) return;
        try {
            await toggleTopicLike(topicId);
        } catch (error) {
            console.error('Error toggling like:', error);
            toast.error('Failed to update like');
        }
    };



    if (!topic) {
        return (
            <div className="h-screen w-full bg-slate-200 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading topic...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen w-full bg-slate-200 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={handleBack} className="-ml-2 hover:bg-slate-100 rounded-full">
                        <ArrowLeft className="w-6 h-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="font-bold text-slate-900 text-lg tracking-tight">
                            {topic.title || 'Topic Chat'}
                        </h1>
                        <p className="text-xs text-slate-500">
                            {activeGroup?.name}
                        </p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="hover:bg-slate-100 rounded-full">
                    <MoreVertical className="w-6 h-6 text-slate-900" />
                </Button>
            </div>

            {/* Topic Card (Pinned) */}
            <div className="bg-white border-b-4 border-blue-500 p-4 shadow-sm">
                {/* Card Header */}
                <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                        {topic.is_anonymous ? (
                            <div className="w-9 h-9 rounded-full bg-slate-300 flex items-center justify-center">
                                <span className="text-xs font-bold text-slate-600">?</span>
                            </div>
                        ) : (
                            <img 
                                src={topic.author?.avatar_url || 'https://placehold.co/36x36'} 
                                alt={topic.author?.display_name || 'User'} 
                                className="w-9 h-9 rounded-full bg-slate-200 object-cover" 
                            />
                        )}
                        <div className="flex flex-col">
                            <span className="font-bold text-slate-900 text-sm leading-none mb-1">
                                {topic.is_anonymous ? (topic.pseudonym || 'Anonymous') : (topic.author?.display_name || 'Unknown')}
                            </span>
                            <span className="text-[11px] text-slate-500 font-medium">
                                {formatTimestamp(topic.created_at)}
                            </span>
                        </div>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${getTagColor(topic.type)}`}>
                        {getTagLabel(topic.type)}
                    </span>
                </div>

                {/* Title */}
                {topic.title && (
                    <h3 className="text-slate-900 text-base font-bold mb-1">
                        {topic.title}
                    </h3>
                )}

                {/* Content */}
                <p className="text-slate-900 text-[15px] leading-snug mb-3 font-normal">
                    {topic.content}
                </p>

                {/* Poll Display */}
                {topic.type === 'poll' && topic.poll && (
                    <div className="space-y-2 mb-3">
                        {topic.poll.options.map((option, idx) => {
                            const percentage = topic.poll!.total_votes > 0 
                                ? Math.round((topic.poll!.vote_counts[idx] / topic.poll!.total_votes) * 100)
                                : 0;
                            return (
                                <div key={idx} className="space-y-1">
                                    <div className="relative h-9 bg-slate-50 rounded-lg overflow-hidden border border-slate-100">
                                        <div
                                            className="absolute top-0 left-0 h-full bg-blue-500/10"
                                            style={{ width: `${percentage}%` }}
                                        />
                                        <div className="absolute inset-0 flex items-center justify-between px-3">
                                            <span className="text-sm font-medium text-slate-900">{option}</span>
                                            <span className="text-xs font-bold text-slate-700">{percentage}%</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Image Display */}
                {topic.type === 'image' && topic.image_url && (
                    <div className="mb-3 rounded-lg overflow-hidden">
                        <img 
                            src={topic.image_url} 
                            alt="Topic image" 
                            className="w-full h-auto max-h-64 object-cover"
                        />
                    </div>
                )}

                {/* Metrics */}
                <div className="flex items-center gap-4 pt-3 border-t border-slate-50">
                    <button
                        onClick={handleLikeClick}
                        className="flex items-center gap-1 group"
                    >
                        <ThumbsUp 
                            className={`w-4 h-4 transition-colors ${
                                topic.is_liked_by_user 
                                    ? 'text-blue-500 fill-blue-500' 
                                    : 'text-slate-400 group-hover:text-slate-600'
                            }`} 
                        />
                        <span className={`text-xs font-medium ${
                            topic.is_liked_by_user 
                                ? 'text-blue-500' 
                                : 'text-slate-500 group-hover:text-slate-700'
                        }`}>
                            {topic.likes_count}
                        </span>
                    </button>
                    <div className="flex items-center gap-1">
                        <Eye className="w-4 h-4 text-slate-400" />
                        <span className="text-xs font-medium text-slate-500">
                            {formatViewCount(topic.views_count)}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <MessageCircle className="w-4 h-4 text-slate-400" />
                        <span className="text-xs font-medium text-slate-500">
                            {topic.replies_count} replies
                        </span>
                    </div>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto bg-slate-100 p-4">
                {isLoadingMessages ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <MessageCircle className="w-16 h-16 text-slate-300 mb-4" />
                        <p className="text-slate-500 text-center">
                            No replies yet. Be the first to comment!
                        </p>
                    </div>
                ) : (
                    <MessageList />
                )}
            </div>

            {/* Chat Input */}
            <div className="bg-white border-t border-slate-200 p-4">
                <ChatInput />
            </div>
        </div>
    );
}
