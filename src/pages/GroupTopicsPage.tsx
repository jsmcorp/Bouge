import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useCallback, useState } from 'react';
import { ArrowLeft, MoreVertical, Info, ThumbsUp, Eye, MessageCircle, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/chatStore';
import { toast } from 'sonner';
import { CreateTopicModal } from '@/components/topics/CreateTopicModal';

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

export default function GroupTopicsPage() {
    const { groupId } = useParams();
    const navigate = useNavigate();
    const {
        groups,
        activeGroup,
        topics,
        isLoadingTopics,
        hasMoreTopics,
        topicsPage,
        fetchTopics,
        toggleTopicLike,
        incrementTopicView,
        subscribeToTopics,
        unsubscribeFromTopics,
        setActiveGroup,
        fetchGroups
    } = useChatStore();

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // Set active group when groupId changes
    useEffect(() => {
        if (!groupId) return;

        // Find and set the active group
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

    // Load topics and subscribe to updates
    useEffect(() => {
        if (!groupId) return;

        const loadData = async () => {
            try {
                // Fetch initial topics (page 0)
                await fetchTopics(groupId, 0);

                // Subscribe to real-time updates
                subscribeToTopics(groupId);
            } catch (error) {
                console.error('Error loading topics:', error);
                toast.error('Failed to load topics');
            }
        };

        loadData();

        // Cleanup: unsubscribe on unmount
        return () => {
            unsubscribeFromTopics();
        };
    }, [groupId, fetchTopics, subscribeToTopics, unsubscribeFromTopics]);

    // Infinite scroll handler
    const handleScroll = useCallback(async () => {
        if (!scrollContainerRef.current || !groupId) return;
        if (isLoadingMore || !hasMoreTopics || isLoadingTopics) return;

        const container = scrollContainerRef.current;
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;

        // Load more when scrolled to 80% of the content
        const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
        if (scrollPercentage > 0.8) {
            setIsLoadingMore(true);
            try {
                await fetchTopics(groupId, topicsPage + 1);
            } catch (error) {
                console.error('Error loading more topics:', error);
                toast.error('Failed to load more topics');
            } finally {
                setIsLoadingMore(false);
            }
        }
    }, [groupId, topicsPage, hasMoreTopics, isLoadingTopics, isLoadingMore, fetchTopics]);

    // Attach scroll listener
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [handleScroll]);

    // Handle topic click - navigate to topic chat and increment view
    const handleTopicClick = async (topicId: string) => {
        try {
            // Increment view count
            await incrementTopicView(topicId);
            
            // Navigate to topic chat
            navigate(`/groups/${groupId}/topics/${topicId}`);
        } catch (error) {
            console.error('Error handling topic click:', error);
        }
    };

    // Handle like button click
    const handleLikeClick = async (e: React.MouseEvent, topicId: string) => {
        e.stopPropagation(); // Prevent topic click
        try {
            await toggleTopicLike(topicId);
        } catch (error) {
            console.error('Error toggling like:', error);
            toast.error('Failed to update like');
        }
    };

    const handleBack = () => {
        // Clear active group
        setActiveGroup(null);
        navigate('/dashboard');
    };

    const handleCreateTopic = () => {
        setIsCreateModalOpen(true);
    };

    return (
        <div className="h-screen w-full bg-slate-200 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={handleBack} className="-ml-2 hover:bg-slate-100 rounded-full">
                        <ArrowLeft className="w-6 h-6 text-slate-900" />
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-slate-200 rounded-full overflow-hidden border border-slate-100">
                            {activeGroup?.avatar_url ? (
                                <img src={activeGroup.avatar_url} alt={activeGroup.name} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-gradient-to-br from-blue-500 to-blue-600" />
                            )}
                        </div>
                        <h1 className="font-bold text-slate-900 text-lg tracking-tight">
                            {activeGroup?.name || 'Topics'}
                        </h1>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="hover:bg-slate-100 rounded-full">
                    <MoreVertical className="w-6 h-6 text-slate-900" />
                </Button>
            </div>

            {/* Topics Feed */}
            <div 
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto pb-32 pt-2 px-0 space-y-0.5 [&::-webkit-scrollbar]:hidden"
            >
                {/* Loading state for initial load */}
                {isLoadingTopics && topics.length === 0 && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
                    </div>
                )}

                {/* Empty state */}
                {!isLoadingTopics && topics.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 px-4">
                        <MessageCircle className="w-16 h-16 text-slate-300 mb-4" />
                        <h3 className="text-lg font-semibold text-slate-900 mb-2">No topics yet</h3>
                        <p className="text-sm text-slate-500 text-center mb-6">
                            Be the first to start a conversation!
                        </p>
                        <Button onClick={handleCreateTopic} className="bg-sky-500 hover:bg-sky-600">
                            <Plus className="w-5 h-5 mr-2" />
                            Create Topic
                        </Button>
                    </div>
                )}

                {/* Topics list */}
                {topics.map((topic) => (
                    <div
                        key={topic.id}
                        onClick={() => handleTopicClick(topic.id)}
                        className="bg-white p-4 active:bg-slate-50 transition-colors cursor-pointer"
                    >
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
                            <div className="flex items-center gap-2">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${getTagColor(topic.type)}`}>
                                    {getTagLabel(topic.type)}
                                </span>
                                {topic.expires_at && (
                                    <Info className="w-4 h-4 text-slate-400" />
                                )}
                            </div>
                        </div>

                        {/* Title (if present) */}
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
                        <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={(e) => handleLikeClick(e, topic.id)}
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
                                        {topic.replies_count}
                                    </span>
                                </div>
                            </div>

                            {/* WhatsApp-style Unread Count */}
                            {topic.unread_count > 0 && (
                                <div className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-green-500">
                                    <span className="text-[10px] font-bold text-white leading-none">
                                        {topic.unread_count}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {/* Loading more indicator */}
                {isLoadingMore && (
                    <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                    </div>
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
                    onClick={() => navigate(`/groups/${groupId}/chat`)}
                    className="w-full h-14 rounded-2xl shadow-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-2 pointer-events-auto transition-all active:scale-[0.98]"
                >
                    <span className="text-lg font-bold">Quick Chat</span>
                </Button>
            </div>

            {/* Create Topic Modal */}
            {groupId && (
                <CreateTopicModal
                    groupId={groupId}
                    isOpen={isCreateModalOpen}
                    onClose={() => setIsCreateModalOpen(false)}
                />
            )}
        </div>
    );
}
