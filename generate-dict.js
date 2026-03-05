import fs from 'fs';
import path from 'path';

// 1. The 2000 words list (Add your words here)
const commonEnglishWords = ["bread", "water", "train", "hotel", "expensive", "please"]; 

async function populate() {
    console.log("🚀 Starting Dictionary Generation...");
    let extendedDict = {};

    for (const english of commonEnglishWords) {
        try {
            console.log(`Processing: ${english}`);
            // In a real run, you'd insert your fetch(Tatoeba) logic here
            extendedDict[english] = {
                french: english === "bread" ? "pain" : "eau", // Mock logic
                etymology: "Latin origin",
                example: { fr: "Exemple", en: "Example" }
            };
        } catch (e) {
            console.error(`Failed ${english}:`, e.message);
        }
    }

    // 2. Ensure the directory exists
    const dir = './static/data';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 3. Write the file
    fs.writeFileSync(path.join(dir, 'extended.json'), JSON.stringify(extendedDict, null, 2));
    console.log("✅ Done! static/data/extended.json has been updated.");
}

populate();