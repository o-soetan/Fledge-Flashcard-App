import { json } from '@sveltejs/kit';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { VITE_R2_ACCOUNT_ID, VITE_R2_ACCESS__KEY_ID, VITE_R2_SECRET_ACCESS_KEY, VITE_R2_BUCKET_NAME } from '$env/static/private';
import { VITE_R2_ACCOUNT_ID, VITE_R2_ACCESS__KEY_ID, VITE_R2_SECRET_ACCESS_KEY, VITE_R2_BUCKET_NAME } from '$env/static/public';

// Initialize the connection to Cloudflare R2
const R2 = new S3Client({
    region: 'auto',
    endpoint: `https://${VITE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: VITE_R2_ACCESS__KEY_ID,
        secretAccessKey: VITE_R2_SECRET_ACCESS_KEY,
    },
});

// POST: Phone drops off the suitcase
export async function POST({ request }) {
    try {
        const { encryptedData } = await request.json();
        
        // Generate a unique Locker Number
        const lockerId = crypto.randomUUID();

        // Upload to Cloudflare R2
        await R2.send(new PutObjectCommand({
            Bucket: VITE_R2_BUCKET_NAME,
            Key: lockerId,
            Body: encryptedData,
            ContentType: 'text/plain',
        }));

        // We rely on Cloudflare's "Lifecycle Rule" to delete this after 24h
        return json({ lockerId });
    } catch (err) {
        console.error(err);
        return json({ error: 'Failed to upload to locker' }, { status: 500 });
    }
}

// GET: Laptop picks up the suitcase
export async function GET({ url }) {
    const lockerId = url.searchParams.get('id');

    if (!lockerId) {
        return json({ error: 'Missing locker ID' }, { status: 400 });
    }

    try {
        // Download from Cloudflare R2
        const object = await R2.send(new GetObjectCommand({
            Bucket: VITE_R2_BUCKET_NAME,
            Key: lockerId
        }));

        // Convert the stream back to text
        const encryptedData = await object.Body.transformToString();
        
        return json({ encryptedData });
    } catch (err) {
        console.error(err);
        return json({ error: 'Locker empty or expired' }, { status: 404 });
    }
}
