import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies up to 25MB (to handle camera/upload base64 images)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Initialize Gemini Client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// Clean and robust JSON extractor helper
function extractJson(raw: string): any {
  if (!raw) return null;
  const text = raw.trim();

  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Look for JSON object or array bounds
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let startIdx = -1;
    let endIdx = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      endIdx = text.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
      endIdx = text.lastIndexOf(']');
    }

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const candidate = text.substring(startIdx, endIdx + 1);
      return JSON.parse(candidate);
    }
  }
  return null;
}

// 1. Analyze Ingredients from Image
app.post('/api/gemini/analyze-image', async (req, res) => {
  try {
    const { image, mimeType = 'image/jpeg' } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาส่งรูปภาพเพื่อทำการวิเคราะห์',
      });
    }

    // Clean base64 data if it contains data URI scheme
    let cleanBase64 = image;
    let detectedMime = mimeType;
    if (image.includes(';base64,')) {
      const parts = image.split(';base64,');
      const mimeMatch = parts[0].match(/data:(.*?)$/);
      if (mimeMatch) {
        detectedMime = mimeMatch[1];
      }
      cleanBase64 = parts[1];
    }

    const ai = getGeminiClient();

    if (!ai) {
      // Fallback detection simulation if API key isn't provided yet
      return res.json({
        success: true,
        ingredients: [
          { name: 'ไข่ไก่', category: 'ไข่และนม', approximateQuantity: '2 ฟอง', clarity: 'clear' },
          { name: 'หมูสับ', category: 'เนื้อสัตว์', approximateQuantity: '150 กรัม', clarity: 'clear' },
          { name: 'กระเทียม', category: 'ผักและสมุนไพร', approximateQuantity: '4-5 กลีบ', clarity: 'clear' },
          { name: 'ข้าวสวย', category: 'ข้าวและแป้ง', approximateQuantity: '1 ชาม', clarity: 'clear' }
        ],
        confidenceNotes: 'ภาพตัวอย่างในโหมดพัฒนา (เชื่อมต่อ Gemini อัตโนมัติเมื่อใส่ API Key)',
        unidentifiableItems: []
      });
    }

    const prompt = `คุณคือผู้เชี่ยวชาญด้านวัตถุดิบอาหารและสูตรอาหารไทยประจำเว็บไซต์ "Cooking Guide"
หน้าที่ของคุณคือวิเคราะห์รูปภาพที่ผู้ใช้ถ่ายหรืออัปโหลดมา เพื่อตรวจหาวัตถุดิบทำอาหารทั้งหมดที่มองเห็นในภาพ
ข้อควรระวัง: ห้ามทึกทักว่าผลลัพธ์ถูกต้อง 100% ให้ระบุความชัดเจนของแต่ละรายการ

กรุณาส่งออกผลลัพธ์เป็น JSON ในรูปแบบนี้เท่านั้น (ไม่ต้องมี markdown นอกเหนือจาก JSON):
{
  "success": true,
  "confidenceNotes": "สรุปสั้นๆ เกี่ยวกับภาพ เช่น แสงและมุมมองชัดเจน พบวัตถุดิบสดหลายรายการ",
  "ingredients": [
    {
      "name": "ชื่อวัตถุดิบ ภาษาไทย สั้นกระชับ เช่น ไข่ไก่, หมูสับ, กระเทียม, พริกขี้หนู, ข้าวสวย, หอมหัวใหญ่, กะเพรา, ซอสปรุงรส",
      "category": "เนื้อสัตว์ / ผักและสมุนไพร / ไข่และนม / เครื่องปรุง / ข้าวและแป้ง / ผลไม้ / อื่นๆ",
      "approximateQuantity": "ปริมาณโดยประมาณ เช่น '2 ฟอง', 'ประมาณ 200 กรัม', '3-4 หัว' หรือ 'ไม่ระบุ'",
      "clarity": "clear หรือ unclear"
    }
  ],
  "unidentifiableItems": [
    "วัตถุหรือสิ่งที่ไม่แน่ใจในภาพ เช่น ถุงพลาสติกบรรจุผงสีขาว หรือ วัตถุที่เบลอ"
  ]
}

หากในภาพไม่มีวัตถุดิบอาหารเลย หรือภาพมืด/เบลอจนระบุไม่ได้อย่างสิ้นเชิง ให้ตอบ:
{
  "success": false,
  "errorMessage": "ไม่สามารถวิเคราะห์ภาพได้ กรุณาถ่ายภาพใหม่ให้เห็นวัตถุดิบชัดเจนขึ้น",
  "ingredients": [],
  "unidentifiableItems": []
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: detectedMime,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
      },
    });

    const textOutput = response.text || '';
    const parsedData = extractJson(textOutput);

    if (!parsedData) {
      throw new Error('Failed to parse JSON from AI');
    }

    return res.json(parsedData);
  } catch (error: any) {
    console.error('Error analyzing image with Gemini:', error);
    return res.status(500).json({
      success: false,
      error: 'ไม่สามารถวิเคราะห์ภาพได้ กรุณาลองใหม่อีกครั้ง หรือเพิ่มวัตถุดิบด้วยตนเอง',
      details: error.message,
    });
  }
});

// 2. Recommend Recipes based on Ingredients
app.post('/api/gemini/recommend-recipes', async (req, res) => {
  const { ingredients = [] } = req.body;

  try {
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาระบุวัตถุดิบอย่างน้อย 1 รายการ',
      });
    }

    const ai = getGeminiClient();

    if (!ai) {
      // High-quality local fallback matching algorithm when API key isn't provided
      const localRecommendations = generateFallbackRecipes(ingredients);
      return res.json({
        success: true,
        recipes: localRecommendations,
      });
    }

    const prompt = `คุณคือสุดยอดเชฟผู้เชี่ยวชาญการทำอาหารไทยประจำเว็บไซต์ Cooking Guide
ผู้ใช้มีวัตถุดิบต่อไปนี้:
${ingredients.map((ing: string, i: number) => `${i + 1}. ${ing}`).join('\n')}

กรุณาวิเคราะห์วัตถุดิบและแนะนำเมนูอาหารที่เหมาะสมที่สุด 4-5 เมนู:
หลักเกณฑ์การแนะนำ:
1. จัดอันดับเมนูที่ตรงกับวัตถุดิบที่ผู้ใช้มีมากที่สุดก่อน (🥇 อันดับ 1, 🥈 อันดับ 2, 🥉 อันดับ 3 ฯลฯ)
2. เมนูควรเป็นเมนูที่คนไทยคุ้นเคย ทำง่าย เหมาะสำหรับนักศึกษาหรือผู้เริ่มต้นทำอาหาร
3. ตรวจสอบว่าวัตถุดิบเพียงพอหรือไม่ และระบุวัตถุดิบที่ต้องซื้อเพิ่มเติม (missingIngredients) อย่างชัดเจน
4. อธิบายขั้นตอนการทำอาหารอย่างละเอียด เข้าใจง่าย ชัดเจนเป็นลำดับขั้นตอน (Step 1, Step 2, ...)
5. ตอบเป็นภาษาไทยทั้งหมด

รูปแบบผลลัพธ์ JSON (ตอบเฉพาะ JSON เท่านั้น):
{
  "recipes": [
    {
      "id": "ภาษาอังกฤษ-สั้น เช่น khao-pad-moo",
      "name": "ชื่อเมนูภาษาไทย เช่น ข้าวผัดหมู",
      "description": "คำอธิบายเมนูสั้นๆ ชวนทาน เช่น ข้าวผัดหมูนุ่มหอมกระทะ ทำง่าย อิ่มอร่อยได้คุณค่า",
      "difficulty": "ง่าย",
      "cookingTime": "15 นาที",
      "servings": 2,
      "rank": 1,
      "matchScore": 95,
      "availableIngredients": ["วัตถุดิบที่ผู้ใช้มีและใช้ในเมนูนี้"],
      "missingIngredients": ["วัตถุดิบที่ต้องเพิ่มเติมหรือซื้อเพิ่ม"],
      "ingredientsWithAmounts": [
        {"name": "ชื่อวัตถุดิบ", "amount": "ปริมาณ เช่น 1 จาน หรือ 100 กรัม", "isAvailable": true},
        {"name": "ชื่อวัตถุดิบที่ต้องเพิ่ม", "amount": "ปริมาณ", "isAvailable": false}
      ],
      "seasonings": [
        "น้ำปลา 1 ช้อนโต๊ะ",
        "น้ำมันพืช 1-2 ช้อนโต๊ะ",
        "ซีอิ๊วขาว 1 ช้อนชา"
      ],
      "steps": [
        {
          "stepNumber": 1,
          "title": "เตรียมวัตถุดิบ",
          "instruction": "หั่นเนื้อหมูเป็นชิ้นพอดีคำ และสับกระเทียมเตรียมไว้",
          "tip": "ซับเนื้อหมูให้แห้งเล็กน้อยก่อนผัด",
          "durationMinutes": 3
        },
        {
          "stepNumber": 2,
          "title": "ตั้งกระทะและเจียวกระเทียม",
          "instruction": "ตั้งกระทะใช้ไฟกลาง ใส่น้ำมันพืชลงไปพอน้ำมันเริ่มร้อนใส่กระเทียมลงไปเจียวจนมีกลิ่นหอม",
          "tip": "ระวังอย่าให้กระเทียมไหม้",
          "durationMinutes": 2
        }
      ],
      "tags": ["เมนูผัด", "อาหารจานเดียว", "ทำง่าย"],
      "chefTip": "เคล็ดลับพิเศษจากเชฟ เช่น ใช้ข้าวเย็นจะทำให้ข้าวร่วนสวยไม่แฉะ"
    }
  ]
}`;

    const generatePromise = ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI generation timeout')), 6500)
    );

    const response: any = await Promise.race([generatePromise, timeoutPromise]);
    const textOutput = response.text || '';
    const parsedData = extractJson(textOutput);

    if (!parsedData || !Array.isArray(parsedData.recipes) || parsedData.recipes.length === 0) {
      throw new Error('Invalid JSON structure from Gemini');
    }

    return res.json({
      success: true,
      recipes: parsedData.recipes,
    });
  } catch (error: any) {
    console.warn('Gemini generation notice, returning guaranteed recipe library match:', error?.message || error);
    // Guaranteed fallback: return rich matching recipes with HTTP 200 so the user never sees an error
    const fallbackRecipes = generateFallbackRecipes(ingredients);
    return res.json({
      success: true,
      warning: 'ระบบเลือกเมนูที่ตรงกับวัตถุดิบจากคลังสูตรอาหารอัจฉริยะ',
      recipes: fallbackRecipes,
    });
  }
});

// Fallback algorithm with rich Thai recipes library
function generateFallbackRecipes(userIngredients: string[]) {
  const normalizedUser = userIngredients.map(i => i.trim().toLowerCase());

  const library = [
    {
      id: 'khai-jeaw-moo-sab',
      name: 'ไข่เจียวหมูสับ',
      description: 'ไข่เจียวหมูสับฟูกรอบนอกนุ่มใน เมนูสามัญประจำบ้านที่ใครกินก็ติดใจ',
      difficulty: 'ง่าย',
      cookingTime: '15 นาที',
      servings: 2,
      coreIngredients: ['ไข่', 'ไข่ไก่', 'หมู', 'หมูสับ'],
      allIngredients: [
        { name: 'ไข่ไก่', amount: '3 ฟอง' },
        { name: 'หมูสับ', amount: '80-100 กรัม' },
        { name: 'น้ำมันพืชสำหรับทอด', amount: '1/2 ถ้วยตวง' },
        { name: 'น้ำปลา', amount: '1 ช้อนโต๊ะ' },
        { name: 'พริกไทยป่น', amount: '1/4 ช้อนชา' },
        { name: 'มะนาว (บีบใส่ไข่ช่วยให้ฟู)', amount: '1/2 ช้อนชา' }
      ],
      seasonings: ['น้ำปลา 1 ช้อนโต๊ะ', 'พริกไทยป่น 1/4 ช้อนชา', 'น้ำมันหอย 1/2 ช้อนชา'],
      steps: [
        { stepNumber: 1, title: 'ตอกไข่และปรุงรส', instruction: 'ตอกไข่ใส่ชามผสม ใส่หมูสับ ปรุงรสด้วยน้ำปลา น้ำมันหอย พริกไทยป่น และบีบน้ำมะนาวเล็กน้อย', tip: 'น้ำมะนาวช่วยให้ไข่เจียวฟูกรอบนานขึ้น', durationMinutes: 2 },
        { stepNumber: 2, title: 'ตีไข่ให้เข้ากัน', instruction: 'ใช้ส้อมตีไข่กับหมูสับให้เนื้อหมูกระจายตัวสม่ำเสมอและขึ้นฟองอากาศเล็กน้อย', tip: 'อย่าให้หมูก้อนหนาเกินไป จะทำให้สุกทั่วถึง', durationMinutes: 2 },
        { stepNumber: 3, title: 'ตั้งกระทะใส่น้ำมัน', instruction: 'ตั้งกระทะใช้ไฟกลางค่อนไปทางแรง ใส่น้ำมันพืช รอจนน้ำมันร้อนจัด (ทดสอบด้วยการหยดไข่ลงไปแล้วฟูทันที)', tip: 'น้ำมันต้องร้อนพอ ไข่จึงจะฟูและไม่อมน้ำมัน', durationMinutes: 3 },
        { stepNumber: 4, title: 'เทไข่ลงทอด', instruction: 'เทส่วนผสมไข่ลงในกระทะจากที่สูงเล็กน้อย ไข่จะฟูกระจายตัวสวยงาม', tip: 'ใช้ตะหลิวเกลี่ยขอบไข่เข้ามาตรงกลางเพื่อให้ไข่สุกทั่ว', durationMinutes: 2 },
        { stepNumber: 5, title: 'กลับด้านไข่', instruction: 'เมื่อด้านล่างเริ่มเหลืองทอง ให้พลิกกลับด้าน ทอดต่อจนสุกสีเหลืองทองทั้งสองด้าน', tip: 'เร่งไฟแรงขึ้นก่อนตักขึ้น 10 วินาทีเพื่อไล่น้ำมัน', durationMinutes: 3 },
        { stepNumber: 6, title: 'สะเด็ดน้ำมันและเสิร์ฟ', instruction: 'ตักไข่เจียวขึ้นพักสะเด็ดน้ำมัน จัดใส่จาน เสิร์ฟร้อนๆ คู่กับข้าวสวยและซอสพริก', tip: 'ทานทันทีเพื่อความกรอบอร่อยที่สุด', durationMinutes: 1 }
      ],
      tags: ['เมนูไข่', 'ทำง่าย', 'ยอดนิยม'],
      chefTip: 'ใส่น้ำมะนาวครึ่งช้อนชาและทอดในน้ำมันร้อนจัด ไข่จะฟูกรอบไม่อมน้ำมัน'
    },
    {
      id: 'moo-kratiam',
      name: 'หมูกระเทียม',
      description: 'หมูผัดกระเทียมพริกไทย หอมกลิ่นกระเทียมเจียว รสชาติเค็มหวานกลมกล่อม',
      difficulty: 'ง่าย',
      cookingTime: '15 นาที',
      servings: 2,
      coreIngredients: ['หมู', 'หมูชิ้น', 'หมูสับ', 'กระเทียม'],
      allIngredients: [
        { name: 'เนื้อหมูสันนอกหรือสันคอ', amount: '200 กรัม' },
        { name: 'กระเทียมไทยสับหยาบ', amount: '2-3 ช้อนโต๊ะ' },
        { name: 'น้ำมันพืช', amount: '2 ช้อนโต๊ะ' },
        { name: 'ผักชีสำหรับโรยหน้า', amount: '1 ต้น' }
      ],
      seasonings: ['ซอสหอยนางรม 1.5 ช้อนโต๊ะ', 'ซีอิ๊วขาว 1 ช้อนโต๊ะ', 'น้ำตาลทราย 1 ช้อนชา', 'พริกไทยป่น 1 ช้อนชา'],
      steps: [
        { stepNumber: 1, title: 'เตรียมเนื้อหมูและกระเทียม', instruction: 'หั่นเนื้อหมูเป็นชิ้นพอดีคำ และสับกระเทียมไทยให้พอหยาบ', tip: 'กระเทียมไทยกลิ่นจะหอมจัดจ้านกว่ากระเทียมจีน', durationMinutes: 3 },
        { stepNumber: 2, title: 'เจียวกระเทียม', instruction: 'ตั้งกระทะใส่น้ำมันพืช ไฟกลาง ใส่กระเทียมลงไปเจียวจนเหลืองทอง ตักแบ่งไว้โรยหน้าครึ่งหนึ่ง', tip: 'อย่าให้กระเทียมไหม้เพราะจะมีรสขม', durationMinutes: 3 },
        { stepNumber: 3, title: 'ผัดเนื้อหมู', instruction: 'ใส่เนื้อหมูลงในกระทะที่มีน้ำมันและกระเทียมที่เหลือ เร่งไฟแรงผัดจนหมูเริ่มสุก', tip: 'ผัดด้วยไฟแรงเนื้อหมูจะนุ่มไม่เหนียว', durationMinutes: 4 },
        { stepNumber: 4, title: 'ปรุงรสชาติ', instruction: 'ใส่ซอสหอยนางรม ซีอิ๊วขาว น้ำตาลทราย และพริกไทยป่น ผัดคลุกเคล้าให้เคลือบเนื้อหมูจนทั่ว', tip: 'หากแห้งไปสามารถเติมน้ำสะอาดได้ 1-2 ช้อนโต๊ะ', durationMinutes: 2 },
        { stepNumber: 5, title: 'จัดจานเสิร์ฟ', instruction: 'ตักใส่จาน โรยหน้าด้วยกระเทียมเจียวที่แบ่งไว้และผักชี เสิร์ฟพร้อมข้าวสวยร้อนๆ', tip: 'ทานคู่กับแตงกวาและพริกน้ำปลาช่วยเพิ่มความอร่อย', durationMinutes: 1 }
      ],
      tags: ['เมนูหมู', 'เมนูผัด', 'ทำง่าย'],
      chefTip: 'แบ่งกระเทียมเจียวไว้โรยหน้าตอนจบ จะทำให้หอมฟุ้งน่ารับประทานยิ่งขึ้น'
    },
    {
      id: 'khao-pad-moo',
      name: 'ข้าวผัดหมู',
      description: 'ข้าวผัดหมู เม็ดข้าวร่วนสวย หอมกลิ่นกระทะ รสชาติกลมกล่อม',
      difficulty: 'ง่าย',
      cookingTime: '15 นาที',
      servings: 2,
      coreIngredients: ['ข้าว', 'ข้าวสวย', 'หมู', 'หมูชิ้น', 'หมูสับ', 'ไข่', 'ไข่ไก่', 'กระเทียม'],
      allIngredients: [
        { name: 'ข้าวสวย (แนะนำข้าวเย็น)', amount: '2 ถ้วย' },
        { name: 'เนื้อหมู', amount: '100 กรัม' },
        { name: 'ไข่ไก่', amount: '1-2 ฟอง' },
        { name: 'กระเทียมสับ', amount: '1 ช้อนโต๊ะ' },
        { name: 'ต้นหอมซอย', amount: '2 ต้น' },
        { name: 'หอมหัวใหญ่หั่นเต๋า', amount: '1/4 หัว' }
      ],
      seasonings: ['ซีอิ๊วขาว 1 ช้อนโต๊ะ', 'ซอสปรุงรส 1 ช้อนโต๊ะ', 'น้ำตาลทราย 1/2 ช้อนชา', 'พริกไทยป่น เล็กน้อย', 'น้ำมันพืช 2 ช้อนโต๊ะ'],
      steps: [
        { stepNumber: 1, title: 'เตรียมวัตถุดิบและข้าว', instruction: 'ใช้ข้าวสวยที่แช่เย็นข้ามคืน นำมายีให้เม็ดข้าวแตกตัวไม่ติดเป็นก้อน', tip: 'ข้าวเย็นจะผัดแล้วร่วนสวย เม็ดไม่แฉะ', durationMinutes: 2 },
        { stepNumber: 2, title: 'ผัดกระเทียมและหมู', instruction: 'ตั้งกระทะใส่น้ำมันไฟกลาง ผัดกระเทียมกับหอมหัวใหญ่จนหอม ใส่หมูลงไปผัดจนสุก 80%', tip: 'อย่าให้หมูสุกเกินไปเพราะจะต้องผัดต่อพร้อมข้าว', durationMinutes: 3 },
        { stepNumber: 3, title: 'ใส่ไข่', instruction: 'เกลี่ยหมูไปไว้ขอบกระทะ ตอกไข่ลงไป ยีให้ไข่แตกตัวพอเริ่มเซ็ตตัวจึงผัดคลุกกับหมู', tip: 'ปล่อยให้ไข่เซ็ตตัวสักครู่เนื้อไข่จะเป็นชิ้นสวยในข้าวผัด', durationMinutes: 2 },
        { stepNumber: 4, title: 'ใส่ข้าวและปรุงรส', instruction: 'เร่งไฟแรง ใส่ข้าวสวยลงไป ปรุงรสด้วยซีอิ๊วขาว ซอสปรุงรส น้ำตาลทราย และพริกไทย ผัดคลุกเคล้าเร็วๆ', tip: 'ใช้หลังตะหลิวกดข้าวให้กระจายตัวและผัดด้วยไฟแรง', durationMinutes: 3 },
        { stepNumber: 5, title: 'ใส่ต้นหอมและจัดเสิร์ฟ', instruction: 'ใส่ต้นหอมซอย ผัดเร็วๆ อีก 30 วินาที ปิดไฟ ตักเสิร์ฟพร้อมมะนาวฝาน แตงกวา และพริกน้ำปลา', tip: 'บีบมะนาวก่อนทานจะช่วยตัดเลี่ยนได้ดีมาก', durationMinutes: 1 }
      ],
      tags: ['อาหารจานเดียว', 'เมนูข้าว', 'ยอดนิยม'],
      chefTip: 'ใช้ข้าวสวยแช่เย็นและผัดด้วยไฟแรง จะได้ข้าวผัดที่หอมกลิ่นกระทะและเม็ดข้าวร่วนเงา'
    },
    {
      id: 'pad-kra-pao-moo-sab',
      name: 'กะเพราหมูสับ',
      description: 'ผัดกะเพราหมูสับรสจัดจ้าน เผ็ดร้อน หอมกลิ่นใบกะเพรา เมนูยอดฮิตอันดับ 1 ของคนไทย',
      difficulty: 'ง่าย',
      cookingTime: '12 นาที',
      servings: 2,
      coreIngredients: ['หมู', 'หมูสับ', 'กระเทียม', 'พริก', 'กะเพรา'],
      allIngredients: [
        { name: 'หมูสับ', amount: '200 กรัม' },
        { name: 'ใบกะเพรา', amount: '1 ถ้วย' },
        { name: 'พริกขี้หนูสวน', amount: '10-15 เม็ด' },
        { name: 'กระเทียม', amount: '1-2 ช้อนโต๊ะ' },
        { name: 'น้ำมันพืช', amount: '1.5 ช้อนโต๊ะ' }
      ],
      seasonings: ['ซอสหอยนางรม 1.5 ช้อนโต๊ะ', 'น้ำปลา 1 ช้อนโต๊ะ', 'ซีอิ๊วดำ 1/2 ช้อนชา (แต่งสี)', 'น้ำตาลทราย 1/3 ช้อนชา'],
      steps: [
        { stepNumber: 1, title: 'โขลกพริกกระเทียม', instruction: 'โขลกพริกขี้หนูกับกระเทียมให้พอหยาบ ไม่ต้องละเอียดมาก', tip: 'โขลกหยาบๆ จะได้กลิ่นหอมและรสเผ็ดที่กำลังดี', durationMinutes: 2 },
        { stepNumber: 2, title: 'ผัดพริกกระเทียม', instruction: 'ตั้งกระทะใส่น้ำมันใช้ไฟกลาง ใส่พริกกระเทียมลงผัดจนส่งกลิ่นหอมฉุน', tip: 'ระวังควันจากพริกจะฉุน เปิดเครื่องดูดควันหรือหน้าต่าง', durationMinutes: 2 },
        { stepNumber: 3, title: 'ใส่หมูสับ', instruction: 'ใส่หมูสับลงไป ยีหมูให้กระจายตัว ผัดจนหมูสุกเกือบทั่ว', tip: 'ผัดด้วยไฟแรง หมูจะแห้งกำลังดีไม่แฉะน้ำ', durationMinutes: 3 },
        { stepNumber: 4, title: 'ปรุงรสชาติเข้มข้น', instruction: 'ปรุงรสด้วยซอสหอยนางรม น้ำปลา น้ำตาลทราย และซีอิ๊วดำเล็กน้อย ผัดให้เข้ากัน', tip: 'ซีอิ๊วดำช่วยให้สีสวยน่าทาน ไม่ควรใส่เยอะเกินไป', durationMinutes: 2 },
        { stepNumber: 5, title: 'ใส่ใบกะเพราและปิดไฟ', instruction: 'ใส่ใบกะเพราลงไป ผัดเร็วๆ ให้กะเพราสลดตัวประมาณ 10-15 วินาที แล้วปิดไฟทันที', tip: 'อย่าผัดใบกะเพรานานเกินไป สีจะดำและเสียความหอม', durationMinutes: 1 },
        { stepNumber: 6, title: 'เสิร์ฟพร้อมไข่ดาว', instruction: 'ตักราดข้าวสวยร้อนๆ ทานคู่กับไข่ดาวกรอบไข่แดงเยิ้ม อร่อยสุดยอด', tip: 'ไข่ดาวกรอบขอบเป็นเพื่อนแท้ของกะเพรา', durationMinutes: 1 }
      ],
      tags: ['เมนูยอดฮิต', 'อาหารจานเดียว', 'รสเผ็ด'],
      chefTip: 'ใส่ใบกะเพราแล้วผัดไฟแรงแป๊บเดียวปิดไฟทันที จะได้กลิ่นหอมฟุ้งและใบกะเพราสีเขียวสด'
    },
    {
      id: 'pad-see-ew-moo',
      name: 'ผัดซีอิ๊วหมู',
      description: 'เส้นใหญ่นุ่มเหนียว ผัดไฟแรงหอมกลิ่นคั่วกระทะ หมูนุ่ม คะน้ากรอบอร่อย',
      difficulty: 'ปานกลาง',
      cookingTime: '15 นาที',
      servings: 2,
      coreIngredients: ['หมู', 'ไข่', 'กระเทียม', 'เส้นใหญ่', 'คะน้า'],
      allIngredients: [
        { name: 'เส้นใหญ่', amount: '250 กรัม' },
        { name: 'เนื้อหมูหมักนุ่ม', amount: '120 กรัม' },
        { name: 'ไข่ไก่', amount: '1-2 ฟอง' },
        { name: 'ผักคะน้าหั่นท่อน', amount: '1-2 ต้น' },
        { name: 'กระเทียมสับ', amount: '1 ช้อนโต๊ะ' }
      ],
      seasonings: ['ซีอิ๊วดำหวาน 1 ช้อนโต๊ะ', 'ซีอิ๊วขาว 1 ช้อนโต๊ะ', 'ซอสหอยนางรม 1 ช้อนโต๊ะ', 'น้ำตาลทราย 1 ช้อนชา', 'น้ำมันพืช 2 ช้อนโต๊ะ'],
      steps: [
        { stepNumber: 1, title: 'คลุกเส้นกับซีอิ๊วดำ', instruction: 'นำเส้นใหญ่มาคลายเส้นแล้วคลุกกับซีอิ๊วดำหวานให้สีเสมอกันก่อนนำไปผัด', tip: 'คลุกก่อนผัดจะทำให้สีสม่ำเสมอและเส้นไม่ติดเป็นก้อน', durationMinutes: 2 },
        { stepNumber: 2, title: 'ผัดกระเทียมและหมู', instruction: 'ตั้งกระทะใส่น้ำมัน ผัดกระเทียมจนหอม ใส่หมูลงไปผัดจนสุก 80%', tip: 'หมูหมักด้วยน้ำมันหอยและแป้งมันเล็กน้อยจะนุ่มมาก', durationMinutes: 3 },
        { stepNumber: 3, title: 'ใส่ไข่และคะน้า', instruction: 'ดันหมูไปข้างกระทะ ตอกไข่ลงไป ยีพอแตก ใส่ก้านคะน้าลงไปผัด', tip: 'ใส่ก้านคะน้าก่อนใบเพราะก้านสุกช้ากว่า', durationMinutes: 2 },
        { stepNumber: 4, title: 'ลงเส้นและปรุงรส', instruction: 'เร่งไฟแรง ใส่เส้นใหญ่และใบคะน้า ปรุงรสด้วยซีอิ๊วขาว ซอสหอยนางรม น้ำตาลทราย คั่วด้วยไฟแรง', tip: 'ปล่อยให้เส้นแนบผิวกระทะสักครู่จะได้กลิ่นหอมไหม้กระทะอันเป็นเอกลักษณ์', durationMinutes: 3 },
        { stepNumber: 5, title: 'ตักเสิร์ฟ', instruction: 'ตักใส่จาน โรยพริกไทยป่น เสิร์ฟพร้อมพริกดองน้ำส้ม พริกป่น และน้ำตาลตามชอบ', tip: 'เหยาะพริกน้ำส้มตัดรสหวานเค็มเพิ่มความกลมกล่อม', durationMinutes: 1 }
      ],
      tags: ['เมนูเส้น', 'อาหารจานเดียว', 'ยอดนิยม'],
      chefTip: 'ใช้ไฟแรงและกระทะร้อนจัด ปล่อยให้เส้นเกรียมขอบเล็กน้อย จะได้กลิ่นหอมคั่วกระทะแบบร้านดัง'
    },
    {
      id: 'tom-jerd-tofu-moo-sab',
      name: 'ต้มจืดเต้าหู้หมูสับ',
      description: 'ต้มจืดซดคล่องคอ น้ำซุปหวานหอมจากผักกาดขาว หมูสับนุ่มปรุงรส และเต้าหู้ไข่',
      difficulty: 'ง่าย',
      cookingTime: '20 นาที',
      servings: 3,
      coreIngredients: ['หมู', 'หมูสับ', 'เต้าหู้', 'เต้าหู้ไข่', 'ผักกาดขาว', 'กระเทียม'],
      allIngredients: [
        { name: 'หมูสับปรุงรส', amount: '150 กรัม' },
        { name: 'เต้าหู้ไข่', amount: '1-2 หลอด' },
        { name: 'ผักกาดขาวหั่นชิ้น', amount: '2 ถ้วย' },
        { name: 'ขึ้นฉ่ายหรือต้นหอม', amount: '1 ต้น' },
        { name: 'น้ำเปล่าหรือน้ำซุป', amount: '4 ถ้วย' },
        { name: 'กระเทียมเจียว', amount: '1 ช้อนโต๊ะ' }
      ],
      seasonings: ['ซีอิ๊วขาว 1.5 ช้อนโต๊ะ', 'เกลือป่น 1/2 ช้อนชา', 'พริกไทยป่น 1/2 ช้อนชา'],
      steps: [
        { stepNumber: 1, title: 'หมักหมูสับ', instruction: 'คลุกหมูสับกับซีอิ๊วขาว 1/2 ช้อนชา และพริกไทยป่นเล็กน้อย ปั้นเป็นก้อนกลมพอดีคำ', tip: 'นวดหมูสับสักครู่จะช่วยให้เนื้อเกาะตัวแน่นไม่แตกเวลาน้ำเดือด', durationMinutes: 3 },
        { stepNumber: 2, title: 'ต้มน้ำซุป', instruction: 'ตั้งหม้อใส่น้ำเปล่า ใช้ไฟกลาง รอจนน้ำเริ่มเดือด ปรุงรสด้วยเกลือและซีอิ๊วขาว', tip: 'หมั่นช้อนฟองออกเพื่อให้น้ำซุปใสสะอาดน่าทาน', durationMinutes: 4 },
        { stepNumber: 3, title: 'ใส่หมูสับก้อน', instruction: 'ใส่หมูสับที่ปั้นไว้ลงในน้ำเดือด รอจนหมูสุกจะลอยขึ้นมาเหนือน้ำ', tip: 'อย่ายีหรือคนแรงในขั้นตอนนี้เพื่อไม่ให้น้ำขุ่น', durationMinutes: 4 },
        { stepNumber: 4, title: 'ใส่ผักกาดขาวและเต้าหู้ไข่', instruction: 'ใส่ผักกาดขาวและเต้าหู้ไข่หั่นท่อน ต้มต่อประมาณ 2-3 นาทีจนผักกาดขาวสุกใสนุ่ม', tip: 'หั่นเต้าหู้ไข่หนาอย่างน้อย 1-1.5 ซม. จะได้ไม่เละง่าย', durationMinutes: 3 },
        { stepNumber: 5, title: 'ใส่ขึ้นฉ่ายและกระเทียมเจียว', instruction: 'ปิดไฟ ใส่ขึ้นฉ่าย ตักใส่ชาม โรยหน้าด้วยกระเทียมเจียวและพริกไทยป่น พร้อมเสิร์ฟ', tip: 'ขึ้นฉ่ายใส่ตอนปิดไฟจะได้กลิ่นหอมสดชื่นที่สุด', durationMinutes: 1 }
      ],
      tags: ['เมนูต้ม', 'เมนูสุขภาพ', 'ซดคล่องคอ'],
      chefTip: 'หมั่นช้อนฟองออกตลอดการต้ม จะได้น้ำซุปใสกระจ่าง รสชาติหวานนุ่มละมุน'
    },
    {
      id: 'khai-pa-lo',
      name: 'ไข่พะโล้',
      description: 'ไข่พะโล้หมูสามชั้น น้ำพะโล้รสชาติเค็มหวาน หอมกลิ่นเครื่องพะโล้แท้ๆ เคี่ยวเข้าเนื้อ',
      difficulty: 'ปานกลาง',
      cookingTime: '35 นาที',
      servings: 4,
      coreIngredients: ['ไข่', 'ไข่ไก่', 'หมู', 'หมูสามชั้น', 'กระเทียม'],
      allIngredients: [
        { name: 'ไข่ต้มปอกเปลือก', amount: '4-6 ฟอง' },
        { name: 'หมูสามชั้นหรือสันคอ', amount: '250 กรัม' },
        { name: 'เต้าหู้ขาวทอด (ถ้ามี)', amount: '1 ก้อน' },
        { name: 'ผงพะโล้หรือสามเกลอ (รากผักชี กระเทียม พริกไทย)', amount: '1 ช้อนโต๊ะ' },
        { name: 'น้ำเปล่า', amount: '3 ถ้วย' }
      ],
      seasonings: ['น้ำตาลปี๊บ 2-3 ช้อนโต๊ะ', 'ซีอิ๊วขาว 2 ช้อนโต๊ะ', 'ซอสหอยนางรม 1 ช้อนโต๊ะ', 'ซีอิ๊วดำหวาน 1 ช้อนโต๊ะ'],
      steps: [
        { stepNumber: 1, title: 'เตรียมสามเกลอและเคี่ยวน้ำตาล', instruction: 'โขลกกระเทียม รากผักชี พริกไทย ตั้งหม้อใส่น้ำมันเล็กน้อย ใส่สามเกลอลงผัดให้หอม ใส่น้ำตาลปี๊บลงไปเคี่ยวจนละลายเป็นสีคาราเมลสวยงาม', tip: 'เคี่ยวน้ำตาลปี๊บจนสีเข้มจะทำให้น้ำพะโล้มีสีสวยและกลิ่นหอมเฉพาะตัว', durationMinutes: 5 },
        { stepNumber: 2, title: 'ผัดหมูและเครื่องพะโล้', instruction: 'ใส่หมูสามชั้นหั่นชิ้นหนาลงไปผัดกับคาราเมลจนตึงตัว ใส่ผงพะโล้ลงไปผัดคลุกเคล้า', tip: 'ผัดหมูให้ผิวด้านนอกสุกรัดตัว จะช่วยกักเก็บความฉ่ำของเนื้อ', durationMinutes: 5 },
        { stepNumber: 3, title: 'เติมน้ำและปรุงรส', instruction: 'เติมน้ำเปล่า ปรุงรสด้วยซีอิ๊วขาว ซอสหอยนางรม และซีอิ๊วดำหวาน คนให้ละลายเข้ากัน', tip: 'ชิมรสชาติให้ออกหวานนำตามด้วยเค็มกลมกล่อม', durationMinutes: 3 },
        { stepNumber: 4, title: 'ใส่ไข่ต้มและเคี่ยว', instruction: 'ใส่ไข่ต้มลงไป หรี่ไฟเป็นไฟอ่อน เคี่ยวทิ้งไว้ประมาณ 20-30 นาที จนน้ำพะโล้ซึมเข้าเนื้อหมูและไข่', tip: 'ยิ่งอุ่นข้ามคืนยิ่งอร่อย ไข่จะเหนียวนุ่มและรสชาติเข้มข้นยิ่งขึ้น', durationMinutes: 20 },
        { stepNumber: 5, title: 'ตักเสิร์ฟ', instruction: 'ตักใส่ชาม โรยผักชีสด เสิร์ฟพร้อมข้าวสวยร้อนๆ', tip: 'น้ำพะโล้คลุกข้าวอร่อยถูกใจทั้งเด็กและผู้ใหญ่', durationMinutes: 1 }
      ],
      tags: ['เมนูต้มพะโล้', 'อาหารไทยคลาสสิก', 'เก็บไว้ทานได้นาน'],
      chefTip: 'เคี่ยวน้ำตาลปี๊บให้เป็นสีคาราเมลก่อนเติมน้ำ จะได้สีพะโล้สวยเป็นธรรมชาติโดยไม่ต้องพึ่งซีอิ๊วดำมากเกินไป'
    }
  ];

  // Calculate score for each recipe based on userIngredients
  const scored = library.map((recipe) => {
    const matchedCore = recipe.coreIngredients.filter(core =>
      normalizedUser.some(userIng => userIng.includes(core) || core.includes(userIng))
    );
    const availableIngredients: string[] = [];
    const missingIngredients: string[] = [];

    recipe.allIngredients.forEach(item => {
      const match = normalizedUser.some(u => item.name.toLowerCase().includes(u) || u.includes(item.name.toLowerCase()));
      if (match) {
        availableIngredients.push(item.name);
      } else {
        missingIngredients.push(item.name);
      }
    });

    const matchScore = Math.min(100, Math.round((matchedCore.length / Math.max(1, recipe.coreIngredients.length)) * 100));

    return {
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
      difficulty: recipe.difficulty,
      cookingTime: recipe.cookingTime,
      servings: recipe.servings,
      matchScore: matchScore > 0 ? matchScore : 50,
      matchedCount: matchedCore.length,
      availableIngredients: availableIngredients.length > 0 ? availableIngredients : [userIngredients[0] || 'วัตถุดิบที่คุณมี'],
      missingIngredients: missingIngredients,
      ingredientsWithAmounts: recipe.allIngredients.map(item => ({
        name: item.name,
        amount: item.amount,
        isAvailable: normalizedUser.some(u => item.name.toLowerCase().includes(u) || u.includes(item.name.toLowerCase())),
      })),
      seasonings: recipe.seasonings,
      steps: recipe.steps,
      tags: recipe.tags,
      chefTip: recipe.chefTip,
    };
  });

  // Sort by matched count descending, then matchScore descending
  scored.sort((a, b) => {
    if (b.matchedCount !== a.matchedCount) {
      return b.matchedCount - a.matchedCount;
    }
    return b.matchScore - a.matchScore;
  });

  // Assign ranks
  return scored.map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

// 3. Recipe Library endpoint to get the default 7 recipes or all recipes
app.get('/api/recipes/library', (req, res) => {
  const allRecipes = generateFallbackRecipes([]);
  res.json({
    success: true,
    recipes: allRecipes,
  });
});

// Start dev or production server
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🍳 Cooking Guide server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
