import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MoreVertical, Info, ThumbsUp, ThumbsDown, BarChart2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/chatStore';

// Mock data based on user's snippet
const MOCK_TOPICS = [
    {
        id: '1',
        author: 'JacobTiger',
        avatar: 'https://placehold.co/36x36',
        content: "I've been pretending to understand what's happening in lectures for the past 3 weeks. At this point I'm too afraid to ask and I'm just hoping everything makes sense before finals 😭",
        timestamp: '3:03 PM • 07 Sep 25',
        likes: 32,
        dislikes: 7,
        views: '1.5k',
        replies: 21,
        unreadCount: 5,
        tag: 'News',
        tagColor: 'bg-purple-200 text-purple-900', // Adjusted for better contrast
        type: 'text'
    },
    {
        id: '2',
        author: 'WeiledCypher',
        avatar: 'https://placehold.co/36x36',
        content: "There's someone in my 9 AM class who always brings coffee for their friend. Honestly, that small gesture makes my entire morning and I don't even know their name",
        timestamp: '3:03 PM • 07 Sep 25',
        likes: 32,
        dislikes: 7,
        views: '1.5k',
        replies: 13,
        unreadCount: 0,
        tag: 'Funny',
        tagColor: 'bg-lime-200 text-lime-900',
        type: 'text'
    },
    {
        id: '3',
        author: 'SterlingHunter',
        avatar: 'https://placehold.co/36x36',
        content: "Favorite Season?",
        timestamp: '3:03 PM • 07 Sep 25',
        likes: 32,
        dislikes: 7,
        views: '1.5k',
        replies: 27,
        unreadCount: 12,
        tag: 'Poll',
        tagColor: 'bg-orange-200 text-orange-900',
        type: 'poll',
        pollData: [
            { label: 'Summer', percentage: 60 },
            { label: 'Winter', percentage: 40 }
        ]
    }
];

export default function GroupTopicsPage() {
    const { groupId } = useParams();
    const navigate = useNavigate();
    const { activeGroup } = useChatStore();

    const handleTopicClick = (_topicId: string) => {
        navigate(`/groups/${groupId}/chat`);
    };

    const handleBack = () => {
        navigate('/dashboard');
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
                {MOCK_TOPICS.map((topic) => (
                    <div
                        key={topic.id}
                        onClick={() => handleTopicClick(topic.id)}
                        className="bg-white p-4 active:bg-slate-50 transition-colors cursor-pointer"
                    >
                        {/* Card Header */}
                        <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2.5">
                                <img src={topic.avatar} alt={topic.author} className="w-9 h-9 rounded-full bg-slate-200 object-cover" />
                                <div className="flex flex-col">
                                    <span className="font-bold text-slate-900 text-sm leading-none mb-1">{topic.author}</span>
                                    <span className="text-[11px] text-slate-500 font-medium">{topic.timestamp}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${topic.tagColor}`}>
                                    {topic.tag}
                                </span>
                                <Info className="w-4 h-4 text-slate-400" />
                            </div>
                        </div>

                        {/* Content */}
                        <p className="text-slate-900 text-[15px] leading-snug mb-3 font-normal">
                            {topic.content}
                        </p>

                        {/* Poll Display */}
                        {topic.type === 'poll' && topic.pollData && (
                            <div className="space-y-2 mb-3">
                                {topic.pollData.map((option, idx) => (
                                    <div key={idx} className="space-y-1">
                                        <div className="relative h-9 bg-slate-50 rounded-lg overflow-hidden border border-slate-100">
                                            <div
                                                className="absolute top-0 left-0 h-full bg-blue-500/10"
                                                style={{ width: `${option.percentage}%` }}
                                            />
                                            <div className="absolute inset-0 flex items-center justify-between px-3">
                                                <span className="text-sm font-medium text-slate-900">{option.label}</span>
                                                <span className="text-xs font-bold text-slate-700">{option.percentage}%</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Metrics */}
                        <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1 group">
                                    <ThumbsUp className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                                    <span className="text-xs font-medium text-slate-500 group-hover:text-slate-700">{topic.likes}</span>
                                </div>
                                <div className="flex items-center gap-1 group">
                                    <ThumbsDown className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                                    <span className="text-xs font-medium text-slate-500 group-hover:text-slate-700">{topic.dislikes}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <BarChart2 className="w-4 h-4 text-slate-400" />
                                    <span className="text-xs font-medium text-slate-500">{topic.views}</span>
                                </div>
                            </div>

                            {/* WhatsApp-style Unread Count */}
                            {topic.unreadCount > 0 && (
                                <div className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-green-500">
                                    <span className="text-[10px] font-bold text-white leading-none">
                                        {topic.unreadCount}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Bottom Actions */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none flex flex-col items-end gap-4">

                {/* Twitter-style FAB for Posting */}
                <Button
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
        </div>
    );
}
