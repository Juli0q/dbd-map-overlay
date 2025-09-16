import os
import json
from pathlib import Path

def scan_map_folders(base_path):
    translations = {
        "maps": {},
        "keywords": {
            "finish": "continue"  # Keeping the existing keyword
        }
    }
    
    # Get all realms (Autohaven Wreckers, etc.)
    realms = [d for d in os.listdir(base_path) if os.path.isdir(os.path.join(base_path, d))]
    
    for realm in realms:
        realm_path = os.path.join(base_path, realm)
        
        # Get all maps in the realm
        try:
            maps = [f for f in os.listdir(realm_path) if f.lower().endswith('.jpg')]
            
            for map_name in maps:
                # Remove the .jpg extension and create the key
                name_without_ext = os.path.splitext(map_name)[0]
                key = name_without_ext.lower()
                # Create the value (Realm/Map format)
                value = f"{realm}/{name_without_ext}"
                
                # Only add if not already present
                if key not in translations["maps"]:
                    translations["maps"][key] = value
                    
        except Exception as e:
            print(f"Error processing realm {realm}: {str(e)}")
    
    return translations

def main():
    # Get the root directory of the project
    script_dir = Path(__file__).parent.parent
    print(f"Script directory: {script_dir}")
    maps_dir = script_dir / "maps" / "SamoelColt"
    output_file = script_dir / "screendetection" / "translations" / "en.json"
    
    # Scan folders and generate translations
    translations = scan_map_folders(maps_dir)
    
    # Write to file with pretty printing
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(translations, f, indent=2, sort_keys=True)
    
    print(f"Successfully generated translations file at: {output_file}")
    print(f"Found {len(translations['maps'])} map translations")

if __name__ == "__main__":
    main()
