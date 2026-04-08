import { json } from '@sveltejs/kit';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { 
    VITE_R2_ACCOUNT_ID, 
    VITE_R2_ACCESS_KEY_ID, 
    VITE_R2_SECRET_ACCESS_KEY, 
    VITE_R2_BUCKET_NAME 
} from '$env/static/private';

// Initialize the connection to Cloudflare R2
const R2 = new S3Client({
    region: 'auto',
    endpoint: `https://${VITE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: VITE_R2_ACCESS_KEY_ID,
        secretAccessKey: VITE_R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
});

const rateLimitStore = new Map();
const LIMIT = 10; // Max requests
const WINDOW_MS = 60000; // 1 minute

function isRateLimited(ip) {
    const now = Date.now();
    const timestamps = rateLimitStore.get(ip) || [];
    const recentRequests = timestamps.filter(t => now - t < WINDOW_MS);
    
    if (recentRequests.length >= LIMIT) return true;
    
    recentRequests.push(now);
    rateLimitStore.set(ip, recentRequests);
    return false;
}

/** @param {string} id */
function isValidId(id) {
    // Ensure lockerId is a hex string (derived from hash) and not a path attempt
    return /^[a-f0-9]{32,128}$/i.test(id);
}

// POST: Phone drops off the suitcase
export async function POST({ request, getClientAddress }) {
    try {
        if (isRateLimited(getClientAddress())) {
            return json({ error: 'Too many requests' }, { status: 429 });
        }

        const body = await request.json();
        const { encryptedData, lockerId: bodyLockerId } = body;
        
        const lockerId = request.headers.get('x-locker-id') || bodyLockerId;

        if (!lockerId || !isValidId(lockerId)) {
            return json({ error: 'Invalid or missing locker ID' }, { status: 400 });
        }

        const storageKey = `users/${lockerId}/bin`;
        await R2.send(new PutObjectCommand({
            Bucket: VITE_R2_BUCKET_NAME,
            Key: storageKey,
            Body: encryptedData,
            ContentType: 'text/plain',
        }));

        return json({ lockerId });
    } catch (err) {
        console.error(err);
        return json({ error: 'Failed to upload to locker' }, { status: 500 });
    }
}

// GET: Laptop picks up the suitcase
export async function GET({ request, getClientAddress }) {
    if (isRateLimited(getClientAddress())) {
        return json({ error: 'Too many requests' }, { status: 429 });
    }

    const lockerId = request.headers.get('x-locker-id');

    if (!lockerId || !isValidId(lockerId)) {
        return json({ error: 'Invalid or missing locker ID' }, { status: 400 });
    }

    try {
        const storageKey = `users/${lockerId}/bin`;
        // Download from Cloudflare R2
        const object = await R2.send(new GetObjectCommand({
            Bucket: VITE_R2_BUCKET_NAME,
            Key: storageKey
        }));

        // Convert the stream back to text
        const encryptedData = await object.Body.transformToString();
        
        return json({ encryptedData });
    } catch (err) {
        console.error(err);
        return json({ error: 'Locker empty or expired' }, { status: 404 });
    }
}

// DELETE: Wipe the suitcase from existence
export async function DELETE({ request, getClientAddress }) {
    if (isRateLimited(getClientAddress())) {
        return json({ error: 'Too many requests' }, { status: 429 });
    }

    const lockerId = request.headers.get('x-locker-id');

    if (!lockerId || !isValidId(lockerId)) {
        return json({ error: 'Invalid or missing locker ID' }, { status: 400 });
    }

    try {
        const storageKey = `users/${lockerId}/bin`;
        await R2.send(new DeleteObjectCommand({
            Bucket: VITE_R2_BUCKET_NAME,
            Key: storageKey
        }));

        return json({ success: true });
    } catch (err) {
        console.error(err);
        return json({ error: 'Failed to delete data' }, { status: 500 });
    }
}
