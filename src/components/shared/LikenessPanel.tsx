'use client';
/* eslint-disable @next/next/no-img-element -- Storage token URLs, see below */

/**
 * Photos, appearance, portrait and avatar of one Child or Character
 * (slice 5.7b). Every change goes through the routes; the likeness parts are
 * made by jobs, so the panel refreshes itself while any part is working and
 * shows each part's progress on its own. Plain `<img>`: the files are
 * Storage token URLs (and emulator URLs under TEST_MODE), not optimisable.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, RefreshCw, Sparkles, Trash2, User as UserIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { api, fileToDataUrl, likenessBusy, type LikenessPart, type PartStatus, type PersonView } from '@/lib/api';

const POLL_MS = 4_000;
const MAX_PHOTOS = 10;

const PART_LABEL: Record<LikenessPart, string> = {
  describe: 'Appearance',
  portrait: 'Portrait',
  avatar: 'Avatar',
  animate: 'Dance',
};

function PartBadge({ part, status }: { part: LikenessPart; status: PartStatus }) {
  if (status === 'idle') return null;
  return (
    <Badge variant={status === 'failed' ? 'destructive' : 'secondary'} className="gap-1" data-testid={`likeness-${part}-${status}`}>
      {status === 'working' && <LoaderCircle className="h-3 w-3 animate-spin" />}
      {PART_LABEL[part]} {status === 'working' ? 'in progress' : 'failed'}
    </Badge>
  );
}

type Props = {
  person: PersonView;
  /** Called with the newest view after every change and refresh. */
  onChange?: (person: PersonView) => void;
};

export function LikenessPanel({ person: initial, onChange }: Props) {
  const { toast } = useToast();
  const [person, setPerson] = useState<PersonView>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => setPerson(initial), [initial]);

  const apply = useCallback((next: PersonView) => {
    setPerson(next);
    onChangeRef.current?.(next);
  }, []);

  // Refresh while a job is still making a part.
  const busy = likenessBusy(person);
  useEffect(() => {
    if (!busy) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const next = await api.people.get(person.kind, person.id);
        if (!stopped) apply(next);
      } catch {
        // Keep the last view; the next tick tries again.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [busy, person.kind, person.id, apply]);

  const run = useCallback(
    async (label: string, action: () => Promise<PersonView>, done?: string) => {
      setPending(label);
      try {
        apply(await action());
        if (done) toast({ title: done });
      } catch (error) {
        toast({ title: 'That did not work', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
      } finally {
        setPending(null);
      }
    },
    [apply, toast]
  );

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    await run('upload', () => api.people.addPhoto(person.kind, person.id, dataUrl), 'Photo added');
  };

  const { likeness, likenessStatus, photoIds } = person;
  const avatarFromPhoto = likeness.avatarSource === 'photo';

  return (
    <Card className="bg-muted/30" data-testid="likeness-panel">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="text-primary h-4 w-4" /> Photos and avatar
        </CardTitle>
        <CardDescription>
          Photos are used to describe how {person.displayName} looks and to draw the portrait for the book pictures. The avatar is
          just for the app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col items-center gap-2">
          {likeness.avatar ? (
            <img src={likeness.avatar} alt={`${person.displayName}'s avatar`} className="rounded-full border-2 border-muted-foreground/20 object-cover h-40 w-40" data-testid="likeness-avatar" />
          ) : (
            <div className="h-40 w-40 flex items-center justify-center bg-muted rounded-full text-muted-foreground">
              {likenessStatus.avatar === 'working' ? <LoaderCircle className="h-10 w-10 animate-spin" /> : <UserIcon className="h-10 w-10" />}
            </div>
          )}
          {person.avatarImagined && (
            <Badge variant="outline" data-testid="likeness-imagined">
              Imagined from the description
            </Badge>
          )}
          {person.kind === 'child' && likeness.avatarAnimation && (
            <video src={likeness.avatarAnimation} className="h-24 w-24 rounded-full object-cover" autoPlay loop muted playsInline aria-label="Dancing avatar" />
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {(Object.keys(PART_LABEL) as LikenessPart[]).map((part) => (
              <PartBadge key={part} part={part} status={likenessStatus[part]} />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {likeness.portrait && (
            <Button type="button" variant="outline" size="sm" disabled={!!pending} onClick={() => run('avatar', () => api.people.setAvatar(person.kind, person.id, 'portrait'), 'Drawing a new avatar')}>
              New avatar from the portrait
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" disabled={!!pending} onClick={() => run('avatar', () => api.people.setAvatar(person.kind, person.id, 'description'), 'Drawing a new avatar')}>
            New avatar from the description
          </Button>
          {photoIds.length > 0 && (
            <Button type="button" variant="ghost" size="sm" disabled={!!pending} onClick={() => run('refresh', () => api.people.refreshLikeness(person.kind, person.id), 'Redoing the appearance and portrait')}>
              <RefreshCw className="h-4 w-4 mr-1" /> Redo from photos
            </Button>
          )}
        </div>

        {likeness.appearance && (
          <div className="rounded-md bg-background p-3 text-sm">
            <p className="font-medium mb-1">How {person.displayName} looks (from the photos)</p>
            <p className="text-muted-foreground" data-testid="likeness-appearance">{likeness.appearance}</p>
          </div>
        )}
        {likeness.portrait && (
          <div className="flex items-center gap-3">
            <img src={likeness.portrait} alt={`${person.displayName}'s portrait`} className="rounded-md object-cover h-16 w-16" data-testid="likeness-portrait" />
            <p className="text-xs text-muted-foreground">Portrait used to keep {person.displayName} looking the same in every picture.</p>
          </div>
        )}

        <div className="space-y-2">
          {photoIds.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photoIds.map(({ id, url }, index) => (
                <div key={id} className="relative group">
                  <img src={url} alt={`Photo ${index + 1}`} className="rounded-md object-cover aspect-square w-full" />
                  {avatarFromPhoto && likeness.avatar === url && <Badge className="absolute bottom-1 left-1">Avatar</Badge>}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex flex-col items-center justify-center gap-1 transition-opacity rounded-md">
                    <Button type="button" size="sm" disabled={!!pending} onClick={() => run('avatar', () => api.people.setAvatar(person.kind, person.id, 'photo', id), 'Avatar set')}>
                      Use as avatar
                    </Button>
                    <Button type="button" size="sm" variant="destructive" disabled={!!pending} onClick={() => run('remove', () => api.people.removePhoto(person.kind, person.id, id), 'Photo removed')}>
                      <Trash2 className="h-4 w-4 mr-1" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {photoIds.length < MAX_PHOTOS && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <ImagePlus className="h-4 w-4" /> Add a photo
              <Input type="file" accept="image/*" onChange={handleFile} disabled={!!pending} className="cursor-pointer" data-testid="likeness-photo-input" />
            </label>
          )}
          {pending === 'upload' && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Uploading…
            </p>
          )}
          {photoIds.length === 0 && <p className="text-sm text-muted-foreground">No photos yet. Without photos the avatar is imagined from the description.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
