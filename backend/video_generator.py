import os
import sys
import json
import time
from urllib.error import URLError
import urllib.request
import urllib.parse
from PIL import Image, ImageDraw, ImageFont
import requests

# Initialize environment variables if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from anthropic import Anthropic
except ImportError:
    print(json.dumps({"error": "anthropic library is not installed"}))
    sys.exit(1)

try:
    from moviepy.editor import ImageClip, AudioFileClip, concatenate_videoclips
except ImportError:
    print(json.dumps({"error": "moviepy library is not installed"}))
    sys.exit(1)

# Helper for parsing arguments
def parse_args():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing input data. Please provide JSON string as an argument."}))
        sys.exit(1)
    
    try:
        return json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse input data: {str(e)}"}))
        sys.exit(1)

def generate_script(client, transcript, work_info, language):
    """
    Generate a 2-person podcast script based on the meeting transcript using Claude
    """
    system_prompt = f"""당신은 산업안전보건 전문가이자 인기 팟캐스트 진행자입니다.
제공된 TBM(Tool Box Meeting) 회의록과 작업 정보를 바탕으로, 신입사원도 쉽게 이해할 수 있는 2-3분 분량의 교육용 오디오 대본을 작성해 주세요.

[요구사항]
1. 화자는 '진행자 A(안전관리자)'와 '진행자 B(작업반장)' 두 명입니다.
2. 둘이 티키타카 대화하는 형식으로 매우 자연스럽게 작성하세요. 기계적인 느낌 없이, 감탄사나 추임새도 넣어서 라디오 방송처럼 작성하세요.
3. 오늘 작업의 핵심 위험 요인과 예방 대책을 반드시 포함하세요.
4. 중요: 작성하는 모든 텍스트(대본의 내용, 영상 제목 등)는 반드시 '{language}' 언어로 번역해서 작성해야 합니다. 화자의 이름(A, B)이나 JSON 키는 절대 번역하지 마세요.
5. 출력 형식은 반드시 아래 JSON 구조를 따라야 합니다. 다른 말이나 텍스트는 전혀 포함하지 마세요, 오직 JSON만 출력하세요:
{{
    "title": "영상 제목 (translated to {language})",
    "script": [
        {{"speaker": "A", "text": "(translated text to {language})"}},
        {{"speaker": "B", "text": "(translated text to {language})"}}
    ]
}}"""

    user_prompt = f"""[작업 정보]
{work_info}

[회의 내용]
{transcript}"""

    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=4000,
        temperature=0.7,
        system=system_prompt,
        messages=[
            {"role": "user", "content": user_prompt}
        ]
    )
    
    # Extract JSON from Claude's response (in case it added conversational text)
    response_text = response.content[0].text
    try:
        json_str = response_text[response_text.find("{"):response_text.rfind("}")+1]
        return json.loads(json_str)
    except:
        return json.loads(response_text)

def synthesize_speech_elevenlabs(api_key, script_data, output_dir):
    """
    Convert the generated script into an audio file using ElevenLabs TTS
    """
    audio_files = []
    
    # Use ElevenLabs predefined voice IDs (Replace with your cloned voice IDs if you have them)
    # Rachel (American, sweet, female) -> We can use for A
    # Drew (American, news, male) -> We can use for B
    # Note: ElevenLabs Turbo v2.5 supports high quality multilingual including Korean
    VOICE_A_ID = "EXAVITQu4vr4xnSDxMaL" # Rachel
    VOICE_B_ID = "pNInz6obpgDQGcFmaJgB" # Adam
    
    url_base = "https://api.elevenlabs.io/v1/text-to-speech"
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key
    }
    
    for i, line in enumerate(script_data['script']):
        speaker = line['speaker']
        text = line['text']
        
        voice_id = VOICE_A_ID if speaker == "A" else VOICE_B_ID
        url = f"{url_base}/{voice_id}"
        
        data = {
            "text": text,
            "model_id": "eleven_multilingual_v2", # Must use v2 for Korean
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        }
        
        temp_audio_path = os.path.join(output_dir, f"temp_audio_{i}.mp3")
        
        response = requests.post(url, json=data, headers=headers)
        
        if response.status_code != 200:
            raise Exception(f"ElevenLabs API error: {response.text}")
            
        with open(temp_audio_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=1024):
                if chunk:
                    f.write(chunk)
                    
        audio_files.append((temp_audio_path, text))
        
    return audio_files

def create_background_image(output_dir, title):
    """
    Create a simple background image for the video
    """
    img_path = os.path.join(output_dir, "background.jpg")
    
    # Create a simple dark blue background
    img = Image.new('RGB', (1920, 1080), color=(26, 38, 57))
    draw = ImageDraw.Draw(img)
    
    # Try to load a font, fallback to default
    font = None
    title_font = None
    
    font_fallbacks = ["malgun.ttf", "arial.ttf", "segoeui.ttf", "msyh.ttc"]
    title_fallbacks = ["malgunbd.ttf", "arialbd.ttf", "segoeuib.ttf", "msyhbd.ttc"]
    
    for f in font_fallbacks:
        try:
            font = ImageFont.truetype(f, 60)
            break
        except IOError:
            continue
            
    for f in title_fallbacks:
        try:
            title_font = ImageFont.truetype(f, 80)
            break
        except IOError:
            continue
            
    if font is None:
        font = ImageFont.load_default()
    if title_font is None:
        title_font = ImageFont.load_default()
        
    # Draw title
    draw.text((100, 100), "오늘의 안전보건교육 (TBM 요약)", font=font, fill=(255, 255, 255))
    
    # Word wrap title if too long
    # Very basic wrapping for demonstration
    wrapped_title = title[:40] + ("..." if len(title) > 40 else "")
    draw.text((100, 250), wrapped_title, font=title_font, fill=(126, 184, 218))
    
    img.save(img_path)
    return img_path

def create_video(audio_files, bg_image_path, final_output_path):
    """
    Combine images and audio files into a single video
    """
    clips = []
    
    for audio_path, _ in audio_files:
        audio_clip = AudioFileClip(audio_path)
        # Create an image clip for the duration of this audio segment
        img_clip = ImageClip(bg_image_path).set_duration(audio_clip.duration)
        img_clip = img_clip.set_audio(audio_clip)
        clips.append(img_clip)
        
    final_video = concatenate_videoclips(clips)
    
    # Write the result to a file
    # use aac as audio codec, h264 as video codec for maximum compatibility
    final_video.write_videofile(
        final_output_path, 
        fps=24, 
        codec="libx264", 
        audio_codec="aac",
        preset="ultrafast",
        logger=None # Suppress moviepy output
    )
    
    # Clean up temp clips
    for clip in clips:
        clip.close()
    final_video.close()
    
    # Clean up temp audio files
    for audio_path, _ in audio_files:
        try:
            os.remove(audio_path)
        except:
            pass
            
    try:
        os.remove(bg_image_path)
    except:
        pass

def main():
    args = parse_args()
    
    claude_key = os.environ.get("CLAUDE_API_KEY")
    elevenlabs_key = os.environ.get("ELEVENLABS_API_KEY")
    
    if not claude_key:
        print(json.dumps({"error": "CLAUDE_API_KEY environment variable is not set"}))
        sys.exit(1)
        
    client = Anthropic(api_key=claude_key)
    
    session_code = args.get("sessionCode")
    transcript = args.get("transcript", "")
    work_info = args.get("workInfo", "")
    language = args.get("language", "Korean")
    output_dir = args.get("outputDir", "./videos")
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    final_output_path = os.path.join(output_dir, f"{session_code}_education.mp4")
    
    try:
        # Step 1: LLM Script Generation (Anthropic Claude)
        script_data = generate_script(client, transcript, work_info, language)
        
        # Step 2: TTS (ElevenLabs API)
        # Check if ElevenLabs key is provided, if not, bypass or throw error
        if not elevenlabs_key or elevenlabs_key == "your_elevenlabs_api_key":
            # For testing without Elevenlabs, we can't really make the video. So we must error out.
            raise Exception("ELEVENLABS_API_KEY is missing or invalid. Please check your .env file.")
            
        audio_files = synthesize_speech_elevenlabs(elevenlabs_key, script_data, output_dir)
        
        # Step 3: Background Image
        bg_image_path = create_background_image(output_dir, script_data["title"])
        
        # Step 4: Video Assembly
        create_video(audio_files, bg_image_path, final_output_path)
        
        # Return success with the path
        print(json.dumps({
            "success": True, 
            "videoPath": final_output_path,
            "title": script_data["title"],
            "script": script_data["script"]
        }))
        
    except Exception as e:
        print(json.dumps({"error": f"Pipeline failed: {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
