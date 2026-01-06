'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useFirestore } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import {
  LoaderCircle,
  ArrowLeft,
  Eye,
  User,
  Users,
  BookOpen,
  ShoppingCart,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { UserProfile, ChildProfile, Character, Story, PrintOrder } from '@/lib/types';
import { format } from 'date-fns';

function formatFriendlyDate(date: Date): string {
  if (!date || isNaN(date.getTime())) return '';
  const day = date.getDate();
  const suffix = (day === 1 || day === 21 || day === 31) ? 'st'
    : (day === 2 || day === 22) ? 'nd'
    : (day === 3 || day === 23) ? 'rd'
    : 'th';
  return `${day}${suffix} ${format(date, 'MMMM yyyy')}`;
}

function safeToDate(value: any): Date | null {
  if (!value) return null;
  if (value.toDate && typeof value.toDate === 'function') {
    return value.toDate();
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function getDisplayDate(date: any): string {
  if (!date) return '';
  if (date.toDate) {
    return date.toDate().toLocaleDateString();
  }
  const d = new Date(date);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString();
  }
  return '';
}

function ChildrenTab({ children, loading }: { children: ChildProfile[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoaderCircle className="h-5 w-5 animate-spin mr-2" />
        <span>Loading children...</span>
      </div>
    );
  }

  const visibleChildren = children?.filter(c => !c.deletedAt) || [];

  if (visibleChildren.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No children found for this parent.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {visibleChildren.map((child) => (
        <Card key={child.id}>
          <CardHeader className="flex flex-row items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={child.avatarUrl} alt={child.displayName} className="object-cover" />
              <AvatarFallback>{child.displayName?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle>{child.displayName}</CardTitle>
              {child.dateOfBirth && <CardDescription>Born: {getDisplayDate(child.dateOfBirth)}</CardDescription>}
              {child.pronouns && <CardDescription>{child.pronouns}</CardDescription>}
            </div>
          </CardHeader>
          <CardContent>
            {child.description && <p className="text-sm text-muted-foreground mb-3">{child.description}</p>}
            {(child.likes?.length > 0 || child.dislikes?.length > 0) && (
              <div className="space-y-2">
                {child.likes?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1">Likes:</p>
                    <div className="flex flex-wrap gap-1">
                      {child.likes.map((like) => (
                        <Badge key={like} variant="secondary" className="text-xs">{like}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {child.dislikes?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1">Dislikes:</p>
                    <div className="flex flex-wrap gap-1">
                      {child.dislikes.map((dislike) => (
                        <Badge key={dislike} variant="destructive" className="text-xs opacity-70">{dislike}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {child.preferredVoiceId && (
              <div className="mt-2">
                <Badge variant="outline" className="text-xs">Voice: {child.preferredVoiceId}</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CharactersTab({ characters, loading }: { characters: Character[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoaderCircle className="h-5 w-5 animate-spin mr-2" />
        <span>Loading characters...</span>
      </div>
    );
  }

  const visibleCharacters = characters?.filter(c => !c.deletedAt) || [];

  if (visibleCharacters.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No characters found for this parent.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {visibleCharacters.map((char) => (
        <Card key={char.id}>
          <CardHeader className="flex flex-row items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={char.avatarUrl} alt={char.displayName} className="object-cover" />
              <AvatarFallback>{char.displayName?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle>{char.displayName}</CardTitle>
              <CardDescription>
                {char.type}{char.type === 'Family' && char.relationship ? ` (${char.relationship})` : ''}
                {' · '}{char.childId ? 'Child-specific' : 'Family-wide'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {char.description && <p className="text-sm text-muted-foreground mb-3">{char.description}</p>}
            {(char.likes?.length > 0 || char.dislikes?.length > 0) && (
              <div className="space-y-2">
                {char.likes?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1">Likes:</p>
                    <div className="flex flex-wrap gap-1">
                      {char.likes.map((like) => (
                        <Badge key={like} variant="secondary" className="text-xs">{like}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {char.dislikes?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1">Dislikes:</p>
                    <div className="flex flex-wrap gap-1">
                      {char.dislikes.map((dislike) => (
                        <Badge key={dislike} variant="destructive" className="text-xs opacity-70">{dislike}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StoriesTab({ stories, children, loading }: { stories: Story[] | null; children: ChildProfile[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoaderCircle className="h-5 w-5 animate-spin mr-2" />
        <span>Loading stories...</span>
      </div>
    );
  }

  const visibleStories = stories?.filter(s => !s.deletedAt) || [];

  if (visibleStories.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No stories found for this parent.
      </div>
    );
  }

  // Group stories by childId
  const childMap = new Map((children || []).map(c => [c.id, c]));
  const storiesByChild = new Map<string, Story[]>();

  for (const story of visibleStories) {
    const childId = story.childId || 'unknown';
    if (!storiesByChild.has(childId)) {
      storiesByChild.set(childId, []);
    }
    storiesByChild.get(childId)!.push(story);
  }

  return (
    <div className="space-y-6">
      {Array.from(storiesByChild.entries()).map(([childId, childStories]) => {
        const child = childMap.get(childId);
        return (
          <div key={childId}>
            <div className="flex items-center gap-2 mb-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={child?.avatarUrl} alt={child?.displayName} className="object-cover" />
                <AvatarFallback>{child?.displayName?.charAt(0) || '?'}</AvatarFallback>
              </Avatar>
              <h3 className="font-semibold">{child?.displayName || 'Unknown Child'}</h3>
              <Badge variant="outline">{childStories.length} stories</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ml-10">
              {childStories.map((story) => (
                <Card key={story.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{story.metadata?.title || 'Untitled Story'}</CardTitle>
                    <CardDescription>
                      {safeToDate(story.createdAt) && formatFriendlyDate(safeToDate(story.createdAt)!)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {story.synopsis && (
                      <p className="text-sm text-muted-foreground line-clamp-3 mb-2">{story.synopsis}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {story.storyMode && (
                        <Badge variant="outline" className="text-xs">{story.storyMode}</Badge>
                      )}
                      <Badge variant={story.status === 'text_ready' ? 'default' : 'secondary'} className="text-xs">
                        {story.status === 'text_ready' ? (
                          <><CheckCircle2 className="h-3 w-3 mr-1" />Ready</>
                        ) : (
                          <><Clock className="h-3 w-3 mr-1" />Pending</>
                        )}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrdersTab({ orders, loading }: { orders: PrintOrder[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoaderCircle className="h-5 w-5 animate-spin mr-2" />
        <span>Loading orders...</span>
      </div>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No print orders found for this parent.
      </div>
    );
  }

  // Sort by createdAt descending
  const sortedOrders = [...orders].sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() || 0;
    const bTime = b.createdAt?.toMillis?.() || 0;
    return bTime - aTime;
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {sortedOrders.map((order) => (
        <Card key={order.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-mono">{order.id}</CardTitle>
              <Badge
                variant={
                  order.fulfillmentStatus === 'delivered' || order.fulfillmentStatus === 'shipped'
                    ? 'default'
                    : order.fulfillmentStatus === 'cancelled' || order.fulfillmentStatus === 'failed'
                    ? 'destructive'
                    : 'secondary'
                }
              >
                {order.fulfillmentStatus}
              </Badge>
            </div>
            <CardDescription>
              {safeToDate(order.createdAt) && formatFriendlyDate(safeToDate(order.createdAt)!)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {order.productSnapshot?.name && (
              <p><span className="text-muted-foreground">Product:</span> {order.productSnapshot.name}</p>
            )}
            {order.quantity && (
              <p><span className="text-muted-foreground">Quantity:</span> {order.quantity}</p>
            )}
            {order.shippingAddress && (
              <div>
                <p className="text-muted-foreground">Ship to:</p>
                <p className="text-xs">
                  {order.shippingAddress.name}<br />
                  {order.shippingAddress.line1}<br />
                  {order.shippingAddress.line2 && <>{order.shippingAddress.line2}<br /></>}
                  {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}<br />
                  {order.shippingAddress.country}
                </p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Badge variant={order.paymentStatus === 'paid' ? 'default' : 'outline'}>
                {order.paymentStatus || 'unpaid'}
              </Badge>
              <Link href={`/admin/print-orders/${order.id}`}>
                <Button variant="outline" size="sm">View Details</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ViewAsParentPage() {
  const params = useParams();
  const targetUid = params.uid as string;
  const { isAuthenticated, isAdmin, loading: adminLoading } = useAdminStatus();
  const firestore = useFirestore();

  // Fetch the target parent's user profile
  const parentDocRef = useMemo(() => {
    if (!firestore || !targetUid) return null;
    return doc(firestore, 'users', targetUid);
  }, [firestore, targetUid]);

  const { data: parentProfile, loading: parentLoading } = useDocument<UserProfile>(parentDocRef);

  // Queries for parent's data
  const childrenQuery = useMemo(() => {
    if (!firestore || !targetUid) return null;
    return query(collection(firestore, 'children'), where('ownerParentUid', '==', targetUid));
  }, [firestore, targetUid]);

  const charactersQuery = useMemo(() => {
    if (!firestore || !targetUid) return null;
    return query(collection(firestore, 'characters'), where('ownerParentUid', '==', targetUid));
  }, [firestore, targetUid]);

  const storiesQuery = useMemo(() => {
    if (!firestore || !targetUid) return null;
    return query(collection(firestore, 'stories'), where('parentUid', '==', targetUid));
  }, [firestore, targetUid]);

  const ordersQuery = useMemo(() => {
    if (!firestore || !targetUid) return null;
    return query(collection(firestore, 'printOrders'), where('parentUid', '==', targetUid));
  }, [firestore, targetUid]);

  const { data: children, loading: childrenLoading } = useCollection<ChildProfile>(childrenQuery);
  const { data: characters, loading: charactersLoading } = useCollection<Character>(charactersQuery);
  const { data: stories, loading: storiesLoading } = useCollection<Story>(storiesQuery);
  const { data: orders, loading: ordersLoading } = useCollection<PrintOrder>(ordersQuery);

  // Count visible items for tab badges
  const childCount = children?.filter(c => !c.deletedAt).length || 0;
  const charCount = characters?.filter(c => !c.deletedAt).length || 0;
  const storyCount = stories?.filter(s => !s.deletedAt).length || 0;
  const orderCount = orders?.length || 0;

  if (adminLoading || parentLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto p-8">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
            <CardDescription>You must be signed in to access this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-8">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Admin access required</CardTitle>
            <CardDescription>You do not have permission to view this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!parentProfile) {
    return (
      <div className="container mx-auto p-8">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>User not found</CardTitle>
            <CardDescription>No user found with ID: {targetUid}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/users">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Users
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      {/* Back navigation */}
      <div className="mb-4">
        <Link href="/admin/users">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Users
          </Button>
        </Link>
      </div>

      {/* Read-only banner */}
      <Alert className="mb-6 bg-amber-50 border-amber-200">
        <Eye className="h-4 w-4" />
        <AlertDescription>
          Viewing as <strong>{parentProfile.email}</strong> — Read Only Mode
        </AlertDescription>
      </Alert>

      {/* Parent info header */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {parentProfile.email}
          </CardTitle>
          <CardDescription>
            Account created: {parentProfile.createdAt && getDisplayDate(parentProfile.createdAt)}
            <span className="mx-2">·</span>
            UID: <span className="font-mono text-xs">{targetUid}</span>
          </CardDescription>
          <div className="flex gap-2 mt-2">
            {parentProfile.roles?.isAdmin && <Badge>Admin</Badge>}
            {parentProfile.roles?.isWriter && <Badge variant="secondary">Writer</Badge>}
            {parentProfile.roles?.isParent && <Badge variant="outline">Parent</Badge>}
          </div>
        </CardHeader>
      </Card>

      {/* Tabbed content */}
      <Tabs defaultValue="children" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="children" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Children
            {childCount > 0 && <Badge variant="secondary" className="ml-1">{childCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="characters" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Characters
            {charCount > 0 && <Badge variant="secondary" className="ml-1">{charCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="stories" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Stories
            {storyCount > 0 && <Badge variant="secondary" className="ml-1">{storyCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="orders" className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            Orders
            {orderCount > 0 && <Badge variant="secondary" className="ml-1">{orderCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="children">
          <Card>
            <CardContent className="pt-6">
              <ChildrenTab children={children} loading={childrenLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="characters">
          <Card>
            <CardContent className="pt-6">
              <CharactersTab characters={characters} loading={charactersLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stories">
          <Card>
            <CardContent className="pt-6">
              <StoriesTab stories={stories} children={children} loading={storiesLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardContent className="pt-6">
              <OrdersTab orders={orders} loading={ordersLoading} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
