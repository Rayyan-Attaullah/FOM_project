from flask import Flask, request, jsonify
from flask_cors import CORS
import xml.etree.ElementTree as ET
from pysat.formula import CNF
from pysat.solvers import Glucose3
from itertools import combinations

app = Flask(__name__)
CORS(app)

class FeatureModel:
    def __init__(self):
        self.features = {}
        self.constraints = []
        self.var_map = {}
        self.reverse_map = {}
        self.next_var = 1
        self.logic_rules = []

    def get_var(self, name):
        if name not in self.var_map:
            self.var_map[name] = self.next_var
            self.reverse_map[self.next_var] = name
            self.next_var += 1
        return self.var_map[name]

    def get_name(self, var):
        return self.reverse_map.get(abs(var))

    def parse_xml(self, xml_file):
        tree = ET.parse(xml_file)
        root = tree.getroot()

        def parse_feature(element, parent=None):
            name = element.attrib["name"]
            feature = {
                "name": name,
                "mandatory": element.attrib.get("mandatory", "false").lower() == "true",
                "parent": parent,
                "children": [],
                "group": None
            }
            
            group = element.find("group")
            if group is not None:
                feature["group"] = group.attrib["type"].upper()
                for child in group:
                    child_feature = parse_feature(child, name)
                    feature["children"].append(child_feature)
            else:
                for child in element.findall("feature"):
                    child_feature = parse_feature(child, name)
                    feature["children"].append(child_feature)
            
            self.features[name] = feature
            return feature

        root_feature = root.find("feature")
        self.root = parse_feature(root_feature)

        for constraint in root.findall(".//constraint"):
            english = constraint.find("englishStatement")
            if english is not None:
                self.constraints.append({
                    "englishStatement": english.text,
                    "type": "requires" if "required to" in english.text else "excludes"
                })

    def generate_rules_and_cnf(self):
        cnf = CNF()
        self.logic_rules = []

        def add_rule(rule):
            self.logic_rules.append(rule)

        def process_feature(feature):
            name = feature["name"]
            var = self.get_var(name)

            # Root
            if not feature["parent"]:
                cnf.append([var])
                add_rule(name)

            # Parent-child relationships
            if feature["parent"]:
                parent_var = self.get_var(feature["parent"])
                if feature["mandatory"]:
                    cnf.append([-parent_var, var])
                    cnf.append([-var, parent_var])
                    add_rule(f"{feature['parent']} → {name}")
                    add_rule(f"{name} → {feature['parent']}")
                else:
                    cnf.append([-var, parent_var])
                    add_rule(f"{name} → {feature['parent']}")

            # XOR groups
            if feature["group"] == "XOR":
                children = feature["children"]
                child_vars = [self.get_var(c["name"]) for c in children]
                child_names = [c["name"] for c in children]

                # Parent implies exactly one child
                add_rule(f"{name} → ({' ∨ '.join(child_names)})")
                cnf.append([-var] + child_vars)

                # Mutual exclusion
                for c1, c2 in combinations(child_names, 2):
                    add_rule(f"¬({c1} ∧ {c2})")
                    cnf.append([-self.get_var(c1), -self.get_var(c2)])

            # OR groups
            elif feature["group"] == "OR":
                children = feature["children"]
                child_names = [c["name"] for c in children]
                child_vars = [self.get_var(c["name"]) for c in children]

                # Parent implies at least one child
                add_rule(f"{name} → ({' ∨ '.join(child_names)})")
                cnf.append([-var] + child_vars)

            for child in feature["children"]:
                process_feature(child)

        process_feature(self.root)

        # Process constraints
        for constraint in self.constraints:
            if constraint["type"] == "requires":
                if "filter" in constraint["englishStatement"]:
                    add_rule("Location → ByLocation")
                    cnf.append([-self.get_var("ByLocation"), self.get_var("Location")])

        return cnf

    def find_mwps(self):
        cnf = self.generate_rules_and_cnf()
        solver = Glucose3()
        for clause in cnf.clauses:
            solver.add_clause(clause)

        mwps = []
        while solver.solve():
            model = solver.get_model()
            mwp = {self.get_name(var) for var in model if var > 0}
            
            # Ensure it contains all mandatory features
            if self.is_valid_mwp(mwp):
                mwps.append(mwp)
            
            # Block this solution
            solver.add_clause([-var for var in model if var > 0])

        return self.filter_minimal_mwps(mwps)

    def is_valid_mwp(self, mwp):
        # Check mandatory features
        for name, feature in self.features.items():
            if feature["mandatory"] and feature["parent"] in mwp and name not in mwp:
                return False
        return True

    def filter_minimal_mwps(self, mwps):
        return [mwp for mwp in mwps 
                if not any(other != mwp and other.issubset(mwp) for other in mwps)]

    def validate_selection(self, selected):
        cnf = self.generate_rules_and_cnf()
        solver = Glucose3()
        
        for clause in cnf.clauses:
            solver.add_clause(clause)

        # Add selection constraints
        for name in self.features:
            var = self.get_var(name)
            if name in selected:
                solver.add_clause([var])
            else:
                solver.add_clause([-var])

        is_valid = solver.solve()
        messages = []

        if not is_valid:
            messages = self.get_violation_messages(selected)

        return {"isValid": is_valid, "messages": messages}

    def get_violation_messages(self, selected):
        messages = []
        
        def check_feature(feature):
            name = feature["name"]
            # Mandatory feature check
            if feature["mandatory"] and feature["parent"] in selected and name not in selected:
                messages.append(f"Missing mandatory feature: {name}")

            # Group constraints
            if name in selected:
                if feature["group"] == "XOR":
                    selected_children = [c["name"] for c in feature["children"] 
                                      if c["name"] in selected]
                    if len(selected_children) != 1:
                        messages.append(f"XOR group {name} must have exactly one selection")
                elif feature["group"] == "OR":
                    selected_children = [c["name"] for c in feature["children"] 
                                      if c["name"] in selected]
                    if not selected_children:
                        messages.append(f"OR group {name} must have at least one selection")

            for child in feature["children"]:
                check_feature(child)

        check_feature(self.root)

        # Check cross-tree constraints
        if "ByLocation" in selected and "Location" not in selected:
            messages.append("Location feature is required for ByLocation")

        return messages

model = FeatureModel()

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['file']
    if not file.filename.endswith('.xml'):
        return jsonify({"error": "Invalid file type"}), 400

    try:
        model.parse_xml(file)
        model.generate_rules_and_cnf()
        mwps = model.find_mwps()

        return jsonify({
            "features": [model.root],
            "logicRules": model.logic_rules,
            "mwps": [list(mwp) for mwp in mwps],
            "constraints": model.constraints
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/validate', methods=['POST'])
def validate():
    selected = set(request.json.get('selectedFeatures', []))
    return jsonify(model.validate_selection(selected))

if __name__ == '__main__':
    app.run(debug=True)
