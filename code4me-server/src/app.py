import markdown, os

from pathlib import Path
from flask import Flask, jsonify, render_template
from api import v1, v2
from limiter import limiter

app = Flask(__name__, static_folder="static", template_folder="templates")
limiter.init_app(app)
app.register_blueprint(v1, url_prefix='/api/v1')
app.register_blueprint(v2, url_prefix='/api/v2')

# TODO: (revert) remove if and beyond
markdown_path = 'markdowns/index.md' if Path('markdowns/index.md').exists() else Path(os.getcwd(), '..', 'markdowns/index.md')
index_md = markdown.markdown(Path(markdown_path).read_text())


@app.errorhandler(429)
def page_not_found(e):
    return jsonify(error=429, text=str(e)), 429


@app.route("/")
@app.route("/index.html")
def home():
    return render_template("index.html", md=index_md)


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=3000)
