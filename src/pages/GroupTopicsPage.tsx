import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, MoreVertical, Info, ThumbsUp, BarChart2, Plus } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/chatStore';
import { supabasePipeline } from '@/lib/supabasePipeline';
import CreateTopicModal from '@/components/topics/CreateTopicModal';

interface Topic {
    id: string;
    group_id: string;
    type: string;
    title: string | null;
    expires_at: string | null;
    views_count: number;
    likes_count: number;
    replies_count: number;
    is_anonymous: boolean;
    created_at: string;
    // Joined data from messages table
    content?: string;
    author?: {
        display_name: string;
        avatar_url: string | null;
        user_id: string;
    };
    // For polls
    poll?: any;
}

export default function GroupTopicsPage() {
    const { groupId } = useParams();
    const navigate = useNavigate();
    const { activeGroup, groups, setActiveGroup } = useChatStore();
    const [topics, setTopics] = useState<Topic[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // CRITICAL FIX: Set active group based on URL parameter
    // This ensures the correct group is active, especially on iOS where
    // navigation doesn't always call setActiveGroup
    useEffect(() => {
        if (groupId && groups.length > 0) {
            const group = groups.find(g => g.id === groupId);
            if (group && (!activeGroup || activeGroup.id !== groupId)) {
                console.log('[GroupTopicsPage] Setting active group:', group.name, 'for groupId:', groupId);
                setActiveGroup(group);
            }
        }
    }, [groupId, groups, activeGroup, setActiveGroup]);

    // Fetch topics from Supabase for the current group
    // Uses direct REST to bypass Supabase client internal state issues after iOS idle
    const fetchTopics = useCallback(async () => {
        if (!groupId) return;

        try {
            setIsLoading(true);
            const startTime = Date.now();
            console.log(`[GroupTopicsPage] 🚀 START fetchTopics for group:`, groupId);

            // Use direct REST query - bypasses Supabase client internal state that can hang after iOS idle
            const { data: topicsData, error: topicsError } = await supabasePipeline.queryDirect<any[]>('topics', {
                select: '*,messages!messages_topic_id_fkey(id,content,user_id,created_at,message_type,users!messages_user_id_fkey(display_name,avatar_url),polls(*))',
                filters: { group_id: groupId },
                order: 'created_at.desc'
            });

            if (topicsError) {
                console.error('[GroupTopicsPage] ❌ Query error:', topicsError);
                setTopics([]);
                setIsLoading(false);
                return;
            }

            console.log(`[GroupTopicsPage] ✅ Fetched ${topicsData?.length || 0} topics in ${Date.now() - startTime}ms total`);

            // Transform the data to match our UI needs
            const transformedTopics: Topic[] = (topicsData || []).map((topic: any) => {
                // Find the ORIGINAL topic message (where message.id === topic.id)
                // This is the message that was created when the topic was created
                // NOT the latest reply in the topic
                const originalMessage = topic.messages?.find((m: any) => m.id === topic.id);
                return {
                    id: topic.id,
                    group_id: topic.group_id,
                    type: topic.type,
                    title: topic.title,
                    expires_at: topic.expires_at,
                    views_count: topic.views_count || 0,
                    likes_count: topic.likes_count || 0,
                    replies_count: topic.replies_count || 0,
                    is_anonymous: topic.is_anonymous,
                    created_at: topic.created_at,
                    content: originalMessage?.content,
                    author: originalMessage?.users ? {
                        display_name: originalMessage.users.display_name,
                        avatar_url: originalMessage.users.avatar_url,
                        user_id: originalMessage.user_id
                    } : undefined,
                    poll: originalMessage?.polls?.[0]
                };
            });

            setTopics(transformedTopics);
        } catch (error: any) {
            console.error('[GroupTopicsPage] ❌ EXCEPTION in fetchTopics:', error?.message || error);
            setTopics([]);
        } finally {
            setIsLoading(false);
        }
    }, [groupId]);

    useEffect(() => {
        fetchTopics();
    }, [fetchTopics]);

    const handleTopicClick = (topicId: string) => {
        navigate(`/groups/${groupId}/topics/${topicId}`);
    };

    const handleBack = () => {
        // Navigate back to dashboard
        console.log('[GroupTopicsPage] Back button clicked, navigating to dashboard');
        // Clear active group to ensure clean state
        setActiveGroup(null);
        navigate('/dashboard', { replace: true });
    };

    const handleCreateTopic = () => {
        setIsCreateModalOpen(true);
    };

    const handleTopicCreated = () => {
        // Refresh topics list after successful creation
        fetchTopics();
    };

    return (
        <div className="h-screen w-full bg-slate-200 flex flex-col overflow-hidden">
            {/* Header with iOS safe area support */}
            <div 
                className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm"
                style={{
                    paddingTop: Capacitor.getPlatform() === 'ios' ? 'calc(env(safe-area-inset-top, 0px) + 12px)' : undefined
                }}
            >
                <div className="flex items-center gap-3">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={handleBack} 
                        className="-ml-2 hover:bg-slate-100 rounded-full"
                    >
                        <ArrowLeft className="w-6 h-6 text-slate-900" />
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-slate-200 rounded-full overflow-hidden border border-slate-100">
                            {/* Placeholder for group icon */}
                            <div className="w-full h-full bg-gradient-to-br from-blue-500 to-blue-600" />
                        </div>
                        <h1 className="font-bold text-slate-900 text-lg tracking-tight">
                            {activeGroup?.name || 'Group Name'}
                        </h1>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="hover:bg-slate-100 rounded-full">
                    <MoreVertical className="w-6 h-6 text-slate-900" />
                </Button>
            </div>

            {/* Topics Feed */}
            <div className="flex-1 overflow-y-auto pb-32 pt-2 px-0 space-y-0.5 [&::-webkit-scrollbar]:hidden">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        <p>Loading topics...</p>
                    </div>
                ) : topics.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        <p>No topics yet for this group</p>
                    </div>
                ) : (
                    topics.map((topic) => (
                        <div
                            key={topic.id}
                            onClick={() => handleTopicClick(topic.id)}
                            className="bg-white p-4 active:bg-slate-50 transition-colors cursor-pointer"
                        >
                        {/* Card Header */}
                        <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2.5">
                                <img 
                                    src={topic.author?.avatar_url || 'https://placehold.co/36x36'} 
                                    alt={topic.author?.display_name || 'Anonymous'} 
                                    className="w-9 h-9 rounded-full bg-slate-200 object-cover" 
                                />
                                <div className="flex flex-col">
                                    <span className="font-bold text-slate-900 text-sm leading-none mb-1">
                                        {topic.is_anonymous ? 'Anonymous' : (topic.author?.display_name || 'Unknown')}
                                    </span>
                                    <span className="text-[11px] text-slate-500 font-medium">
                                        {new Date(topic.created_at).toLocaleString('en-US', {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                            hour12: true,
                                            day: '2-digit',
                                            month: 'short',
                                            year: '2-digit'
                                        })}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                                    topic.type === 'poll' ? 'bg-orange-200 text-orange-900' :
                                    topic.type === 'news' ? 'bg-purple-200 text-purple-900' :
                                    topic.type === 'confession' ? 'bg-pink-200 text-pink-900' :
                                    'bg-lime-200 text-lime-900'
                                }`}>
                                    {topic.type === 'text' ? 'discussion' : topic.type}
                                </span>
                                <Info className="w-4 h-4 text-slate-400" />
                            </div>
                        </div>

                        {/* Title */}
                        {topic.title && (
                            <h3 className="text-slate-900 text-base font-bold mb-2">{topic.title}</h3>
                        )}

                        {/* Content */}
                        {topic.content && (
                            <p className="text-slate-900 text-[15px] leading-snug mb-3 font-normal">
                                {topic.content}
                            </p>
                        )}

                        {/* Poll Display */}
                        {topic.type === 'poll' && topic.poll && topic.poll.options && (
                            <div className="space-y-2 mb-3">
                                {(topic.poll.options as string[]).map((option: string, idx: number) => {
                                    const voteCountsArray = topic.poll.vote_counts || [];
                                    const totalVotes = voteCountsArray.reduce((a: number, b: number) => a + b, 0) || 0;
                                    const voteCount = voteCountsArray[idx] || 0;
                                    const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
                                    
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

                        {/* Metrics */}
                        <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1 group">
                                    <ThumbsUp className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                                    <span className="text-xs font-medium text-slate-500 group-hover:text-slate-700">
                                        {topic.likes_count}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <BarChart2 className="w-4 h-4 text-slate-400" />
                                    <span className="text-xs font-medium text-slate-500">
                                        {topic.views_count}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-xs font-medium text-slate-500">
                                        {topic.replies_count} replies
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    ))
                )}
            </div>

            {/* Bottom Actions */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none flex flex-col items-end gap-4">

                {/* Twitter-style FAB for Posting */}
                <Button
                    onClick={handleCreateTopic}
                    className="h-14 w-14 rounded-full shadow-xl bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center pointer-events-auto transition-transform hover:scale-105 active:scale-95"
                >
                    <Plus className="w-7 h-7" />
                </Button>

                {/* Quick Chat Button */}
                <Button
                    onClick={() => navigate(`/groups/${groupId}/chat`, { replace: true })}
                    className="w-full h-14 rounded-2xl shadow-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-2 pointer-events-auto transition-all active:scale-[0.98]"
                >
                    <span className="text-lg font-bold">Quick Chat</span>
                </Button>
            </div>

            {/* Create Topic Modal */}
            {groupId && (
                <CreateTopicModal
                    isOpen={isCreateModalOpen}
                    onClose={() => setIsCreateModalOpen(false)}
                    groupId={groupId}
                    onTopicCreated={handleTopicCreated}
                />
            )}
        </div>
    );
}
