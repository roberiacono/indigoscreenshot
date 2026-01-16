from PIL import Image, ImageDraw
import math

def create_icon(size, filename):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Background: Rounded Square
    bg_color = "#7c86ff"
    radius = size // 5
    draw.rounded_rectangle([(0,0), (size, size)], radius=radius, fill=bg_color)
    
    # Symbol: White Aperture
    center = size // 2
    outer_r = size * 0.35
    inner_r = size * 0.12
    
    # Draw solid white circle first
    draw.ellipse([center - outer_r, center - outer_r, center + outer_r, center + outer_r], fill="white")
    
    # Draw central hole (Indigo)
    draw.ellipse([center - inner_r, center - inner_r, center + inner_r, center + inner_r], fill=bg_color)
    
    # Draw 6 shutter lines (Indigo)
    # Tangent style: From inner circle tanget to outer edge
    cut_width = max(2, size // 20)
    
    for i in range(6):
        angle_deg = i * 60
        angle_rad = math.radians(angle_deg)
        
        # Start at inner radius (vertex of implied hexagon)
        # Actually proper shutter blades start from the tangent of the inner circle
        # Let's verify simplistic look: Line from Inner(angle) to Outer(angle + 60)
        
        # Inner point
        ix = center + inner_r * math.cos(angle_rad)
        iy = center + inner_r * math.sin(angle_rad)
        
        # Outer point (shifted)
        ox = center + outer_r * math.cos(math.radians(angle_deg + 40)) # 40 deg twist
        oy = center + outer_r * math.sin(math.radians(angle_deg + 40))
        
        draw.line([(ix, iy), (ox, oy)], fill=bg_color, width=cut_width)

    img.save(filename)
    print(f"Saved {filename}")

create_icon(16, 'icons/icon16.png')
create_icon(48, 'icons/icon48.png')
create_icon(128, 'icons/icon128.png')
