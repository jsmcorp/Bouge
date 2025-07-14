import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { 
  Search, 
  Upload, 
  Image, 
  FileText, 
  Link, 
  Download, 
  MoreHorizontal,
  Grid3X3,
  List
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatStore } from '@/store/chatStore';

export function GroupMedia() {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const { groupMedia } = useChatStore();

  const filteredMedia = groupMedia.filter(media =>
    media.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const photoMedia = filteredMedia.filter(media => media.type === 'photo');
  const documentMedia = filteredMedia.filter(media => media.type === 'document');
  const linkMedia = filteredMedia.filter(media => media.type === 'link');

  const MediaItem = ({ media }: { media: any }) => {
    if (viewMode === 'grid' && media.type === 'photo') {
      return (
        <Card className="glass-card border-border/30 overflow-hidden group cursor-pointer hover:shadow-lg transition-all">
          <div className="relative aspect-square">
            <img 
              src={media.url} 
              alt={media.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <Button variant="secondary" size="sm" className="h-8 px-3">
                <Download className="w-3 h-3 mr-1" />
                Download
              </Button>
            </div>
          </div>
          <CardContent className="p-2">
            <p className="text-xs font-medium truncate">{media.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(media.uploaded_at), { addSuffix: true })}
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="glass-card border-border/30">
        <CardContent className="p-3">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 bg-muted/50 rounded-lg">
              {media.type === 'photo' && <Image className="w-4 h-4" />}
              {media.type === 'document' && <FileText className="w-4 h-4" />}
              {media.type === 'link' && <Link className="w-4 h-4" />}
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{media.name}</p>
              <div className="flex items-center space-x-2 mt-1">
                <Avatar className="w-4 h-4">
                  <AvatarImage src={media.user.avatar_url || ''} />
                  <AvatarFallback className="text-xs">
                    {media.user.display_name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <p className="text-xs text-muted-foreground">
                  {media.user.display_name}
                </p>
                <span className="text-xs text-muted-foreground">•</span>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(media.uploaded_at), { addSuffix: true })}
                </p>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <MoreHorizontal className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <Download className="w-3 h-3 mr-2" />
                  Download
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Link className="w-3 h-3 mr-2" />
                  Copy Link
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive">
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Search and Controls */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search media..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-9 text-sm"
          />
        </div>
        
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <Upload className="w-3 h-3 mr-1" />
            Upload
          </Button>
          
          <div className="flex items-center space-x-1">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('grid')}
              className="h-7 w-7 p-0"
            >
              <Grid3X3 className="w-3 h-3" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="h-7 w-7 p-0"
            >
              <List className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Media Tabs */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-8">
          <TabsTrigger value="all" className="text-xs">
            All ({filteredMedia.length})
          </TabsTrigger>
          <TabsTrigger value="photos" className="text-xs">
            <Image className="w-3 h-3 mr-1" />
            {photoMedia.length}
          </TabsTrigger>
          <TabsTrigger value="docs" className="text-xs">
            <FileText className="w-3 h-3 mr-1" />
            {documentMedia.length}
          </TabsTrigger>
          <TabsTrigger value="links" className="text-xs">
            <Link className="w-3 h-3 mr-1" />
            {linkMedia.length}
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="all" className="mt-4">
          {filteredMedia.length === 0 ? (
            <div className="text-center py-8">
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? 'No media found' : 'No media shared yet'}
              </p>
              <Button variant="outline" size="sm" className="mt-2">
                <Upload className="w-3 h-3 mr-1" />
                Upload First File
              </Button>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
              {filteredMedia.map((media) => (
                <MediaItem key={media.id} media={media} />
              ))}
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="photos" className="mt-4">
          <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
            {photoMedia.map((media) => (
              <MediaItem key={media.id} media={media} />
            ))}
          </div>
        </TabsContent>
        
        <TabsContent value="docs" className="mt-4">
          <div className="space-y-2">
            {documentMedia.map((media) => (
              <MediaItem key={media.id} media={media} />
            ))}
          </div>
        </TabsContent>
        
        <TabsContent value="links" className="mt-4">
          <div className="space-y-2">
            {linkMedia.map((media) => (
              <MediaItem key={media.id} media={media} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}