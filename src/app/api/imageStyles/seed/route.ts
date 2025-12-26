import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { getFirestore } from 'firebase-admin/firestore';

const SEED_IMAGE_STYLES = [
    {
        title: "The Soft Vector Style",
        description: "A clean, modern style with high clarity and no visual clutter. Best for board books and learning concepts.",
        ageRange: "0-4",
        stylePrompt: "flat, modern vector art with soft rounded corners, pastel color palette, simple geometric shapes, and a minimalist composition without clutter",
        sampleDescription: "A friendly cartoon elephant playing with colorful building blocks"
    },
    {
        title: "The Textured Paper Cut-Out",
        description: "A tactile, collage-based style that emphasizes texture and shapes. Best for nature stories and animal characters.",
        ageRange: "0-4",
        stylePrompt: "layered paper cut-out collage art, featuring textured craft paper, distinct drop shadows to create depth, and vibrant, saturated colors similar to Eric Carle",
        sampleDescription: "A bright red ladybug sitting on a green leaf with the sun shining"
    },
    {
        title: "The Classic Watercolor & Ink",
        description: "A traditional, soft, and nostalgic style evocative of vintage storybooks. Best for gentle adventures and fables.",
        ageRange: "4-8",
        stylePrompt: "classic hand-drawn pen and ink illustration with loose, dreamy watercolor washes, vintage storybook aesthetic, gentle cross-hatching, and a warm, nostalgic atmosphere",
        sampleDescription: "A curious rabbit in a waistcoat exploring a magical garden"
    },
    {
        title: "The Vibrant Acrylic Impasto",
        description: "A bold, energetic style with visible brushstrokes and rich texture. Best for action-oriented stories and funny characters.",
        ageRange: "4-8",
        stylePrompt: "expressive acrylic painting with visible thick brushstrokes (impasto), rich textures, bold lighting, and a vibrant, energetic color palette",
        sampleDescription: "A playful monkey swinging through a jungle with bright tropical flowers"
    },
    {
        title: "The Colored Pencil Sketch",
        description: "A soft, fuzzy, and intimate style. Best for emotional stories about family, friendship, or quiet moments.",
        ageRange: "4-8",
        stylePrompt: "soft colored pencil on rough grain paper, featuring visible sketch lines, soft shading, muted earth tones, and a hand-drawn, fuzzy texture",
        sampleDescription: "A child and their teddy bear reading together by a cozy fireplace"
    },
    {
        title: "The 3D Claymation",
        description: "A whimsical, photographic style that looks like physical toys. Best for humorous stories and quirky modern tales.",
        ageRange: "4-8",
        stylePrompt: "whimsical 3D claymation style resembling polymer clay or plasticine, with soft studio lighting, tilt-shift photography depth of field, and a tactile, toy-like appearance",
        sampleDescription: "A cheerful clay robot having a tea party with stuffed animals"
    },
    {
        title: "The Magical Digital Fantasy",
        description: "A highly polished, cinematic style with lighting effects similar to animated movies. Best for fantasy adventures and epic journeys.",
        ageRange: "8-12",
        stylePrompt: "cinematic digital concept art with glowing lighting effects, intricate details, atmospheric depth, and a magical, semi-realistic style similar to modern animated feature films",
        sampleDescription: "A young wizard casting spells with glowing runes in an ancient library"
    },
    {
        title: "The Mixed Media Collage",
        description: "An artistic, surreal style combining different visual elements. Best for mystery books, poetry, or eccentric characters.",
        ageRange: "8-12",
        stylePrompt: "quirky mixed media collage combining vintage botanical illustrations, fabric textures, and hand-drawn doodles, creating a surreal and artistic composition",
        sampleDescription: "A dreamlike scene with a girl surrounded by floating books and butterflies"
    },
    {
        title: "The Graphic Novel Line Art",
        description: "A clean comic-book style with bold lines and dramatic angles. Best for superheroes and school stories.",
        ageRange: "8-12",
        stylePrompt: "clean, bold comic book style with dynamic line weight, flat 'cel-shaded' coloring, expressive character faces, and dramatic perspective",
        sampleDescription: "A kid in a superhero cape leaping between city rooftops"
    },
    {
        title: "The Lino-Cut Folk Art",
        description: "A distinct, blocky style with a handmade print feel. Best for myths, legends, and historical fiction.",
        ageRange: "8-12",
        stylePrompt: "folk-art inspired linocut print style, featuring bold blocky shapes, a limited color palette of 3-4 colors, and visible carving textures",
        sampleDescription: "A brave knight facing a dragon in a medieval castle courtyard"
    }
];

export async function POST(request: Request) {
    try {
        await initFirebaseAdminApp();
        const user = await requireParentOrAdminUser(request);

        if (!user.claims.isAdmin) {
            return NextResponse.json(
                { ok: false, errorMessage: 'Admin access required' },
                { status: 403 }
            );
        }

        const firestore = getFirestore();
        const imageStylesRef = firestore.collection('imageStyles');

        const results = [];
        const now = new Date();

        for (const style of SEED_IMAGE_STYLES) {
            const docRef = imageStylesRef.doc();
            await docRef.set({
                ...style,
                sampleImageUrl: null,
                createdAt: now,
                updatedAt: now,
            });

            results.push({
                id: docRef.id,
                title: style.title,
            });
        }

        return NextResponse.json({
            ok: true,
            message: `Successfully seeded ${results.length} image styles`,
            styles: results,
        }, { status: 200 });

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        return NextResponse.json(
            {
                ok: false,
                errorMessage: `API /imageStyles/seed route error: ${errorMessage}`
            },
            { status: 500 }
        );
    }
}
