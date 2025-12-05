import { useState } from 'react';
import { X, Image as ImageIcon, BarChart2, MessageSquare, Newspaper, Ghost } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore, CreateTopicInput } from '@/store/chatStore';
import { toast } from 'sonner';

interface CreateTopicModalProps {
    groupId: string;
    isOpen: boolean;
    onClose: () => void;
}

type TopicType = 'text' | 'poll' | 'confession' | 'news' | 'image';
type ExpirationDuration = '24h' | '7d' | 'never';

export function CreateTopicModal({ groupId, isOpen, onClose }: CreateTopicModalProps) {
    const { createTopic } = useChatStore();
    
    const [selectedType, setSelectedType] = useState<TopicType>('text');
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
    const [expiresIn, setExpiresIn] = useState<ExpirationDuration>('7d');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const topicTypes = [
        { type: 'text' as TopicType, label: 'Text', icon: MessageSquare, color: 'bg-lime-100 text-lime-700' },
        { type: 'poll' as TopicType, label: 'Poll', icon: BarChart2, color: 'bg-orange-100 text-orange-700' },
        { type: 'confession' as TopicType, label: 'Confession', icon: Ghost, color: 'bg-pink-100 text-pink-700' },
        { type: 'news' as TopicType, label: 'News', icon: Newspaper, color: 'bg-purple-100 text-purple-700' },
        { type: 'image' as TopicType, label: 'Image', icon: ImageIcon, color: 'bg-blue-100 text-blue-700' },
    ];

    const expirationOptions = [
        { value: '24h' as ExpirationDuration, label: '24 Hours' },
        { value: '7d' as ExpirationDuration, label: '7 Days' },
        { value: 'never' as ExpirationDuration, label: 'Never' },
    ];

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                toast.error('Image must be less than 5MB');
                return;
            }
            setImageFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const addPollOption = () => {
        if (pollOptions.length < 10) {
            setPollOptions([...pollOptions, '']);
        }
    };

    const removePollOption = (index: number) => {
        if (pollOptions.length > 2) {
            setPollOptions(pollOptions.filter((_, i) => i !== index));
        }
    };

    const updatePollOption = (index: number, value: string) => {
        const newOptions = [...pollOptions];
        newOptions[index] = value;
        setPollOptions(newOptions);
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);

        try {
            const input: CreateTopicInput = {
                group_id: groupId,
                type: selectedType,
                title: title.trim() || undefined,
                content: content.trim(),
                expires_in: expiresIn,
                is_anonymous: selectedType === 'confession',
                poll_options: selectedType === 'poll' ? pollOptions.filter(opt => opt.trim()) : undefined,
                image_file: selectedType === 'image' ? imageFile || undefined : undefined,
            };

            // Validation is now handled in topicActions.ts
            await createTopic(input);
            
            toast.success('Topic created successfully!');
            handleClose();
        } catch (error: any) {
            console.error('Error creating topic:', error);
            // Display the user-friendly error message from the error handler
            toast.error(error.message || 'Failed to create topic');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        // Reset form
        setSelectedType('text');
        setTitle('');
        setContent('');
        setPollOptions(['', '']);
        setExpiresIn('7d');
        setImageFile(null);
        setImagePreview(null);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto flex flex-col">
                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-900">Create Topic</h2>
                    <Button variant="ghost" size="icon" onClick={handleClose} className="rounded-full">
                        <X className="w-5 h-5" />
                    </Button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    {/* Topic Type Selection */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Topic Type
                        </label>
                        <div className="grid grid-cols-5 gap-2">
                            {topicTypes.map(({ type, label, icon: Icon, color }) => (
                                <button
                                    key={type}
                                    onClick={() => setSelectedType(type)}
                                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all ${
                                        selectedType === type
                                            ? 'border-blue-500 bg-blue-50'
                                            : 'border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center`}>
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <span className="text-xs font-medium text-slate-700">{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Title (optional) */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Title (Optional)
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Give your topic a title..."
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            maxLength={100}
                        />
                    </div>

                    {/* Content / Question */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            {selectedType === 'poll' ? 'Question' : 'Content'}
                        </label>
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={
                                selectedType === 'poll'
                                    ? 'What would you like to ask?'
                                    : selectedType === 'confession'
                                    ? 'Share your confession anonymously...'
                                    : 'What\'s on your mind?'
                            }
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px] resize-none"
                            maxLength={500}
                        />
                        <div className="text-xs text-slate-500 mt-1 text-right">
                            {content.length}/500
                        </div>
                    </div>

                    {/* Poll Options */}
                    {selectedType === 'poll' && (
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Poll Options
                            </label>
                            <div className="space-y-2">
                                {pollOptions.map((option, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={option}
                                            onChange={(e) => updatePollOption(index, e.target.value)}
                                            placeholder={`Option ${index + 1}`}
                                            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            maxLength={50}
                                        />
                                        {pollOptions.length > 2 && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => removePollOption(index)}
                                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                                {pollOptions.length < 10 && (
                                    <Button
                                        variant="outline"
                                        onClick={addPollOption}
                                        className="w-full"
                                    >
                                        Add Option
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Image Upload */}
                    {selectedType === 'image' && (
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Image
                            </label>
                            {imagePreview ? (
                                <div className="relative">
                                    <img
                                        src={imagePreview}
                                        alt="Preview"
                                        className="w-full h-48 object-cover rounded-lg"
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                            setImageFile(null);
                                            setImagePreview(null);
                                        }}
                                        className="absolute top-2 right-2 bg-white/90 hover:bg-white"
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            ) : (
                                <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-slate-400 transition-colors">
                                    <ImageIcon className="w-12 h-12 text-slate-400 mb-2" />
                                    <span className="text-sm text-slate-500">Click to upload image</span>
                                    <span className="text-xs text-slate-400 mt-1">Max 5MB</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleImageSelect}
                                        className="hidden"
                                    />
                                </label>
                            )}
                        </div>
                    )}

                    {/* Expiration Duration */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Expires In
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {expirationOptions.map(({ value, label }) => (
                                <button
                                    key={value}
                                    onClick={() => setExpiresIn(value)}
                                    className={`px-4 py-2 rounded-lg border-2 font-medium transition-all ${
                                        expiresIn === value
                                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                                            : 'border-slate-200 text-slate-700 hover:border-slate-300'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Anonymous Notice for Confessions */}
                    {selectedType === 'confession' && (
                        <div className="bg-pink-50 border border-pink-200 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                                <Ghost className="w-5 h-5 text-pink-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-semibold text-pink-900">Anonymous Posting</p>
                                    <p className="text-xs text-pink-700 mt-1">
                                        Your identity will be hidden. A random pseudonym will be assigned.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !content.trim()}
                        className="bg-sky-500 hover:bg-sky-600"
                    >
                        {isSubmitting ? 'Creating...' : 'Create Topic'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
